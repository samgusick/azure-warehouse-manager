import * as vscode from "vscode";
import { WarehouseProvider, WarehouseItem } from "./warehouseProvider";
import { credential } from "./azureAuth";
import { SqlManagementClient } from "@azure/arm-sql";
import { SubscriptionClient } from "@azure/arm-subscriptions";

export async function activate(context: vscode.ExtensionContext) {
  // Register Show Warehouse Details command
  // Removed warehouse dropdown functionality
  // Register Scale command
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.scaleWarehouse", async (item: WarehouseItem) => {
      if (!(item instanceof WarehouseItem)) {
        return;
      }
      // Only allow scaling if warehouse is online
      if (item.status !== "Online") {
        vscode.window.showWarningMessage(`Cannot scale ${item.name} because it is not online.`);
        return;
      }
      // Use Azure CLI instead of SDK for scaling
      const normalizedServer = item.server.replace(/\.database\.windows\.net$/i, "");
      // Common DWU levels
      const dwuLevels = [100, 200, 300, 400, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 7500, 10000, 15000, 30000];
      const options = dwuLevels.map(dwu => {
        const skuName = `DW${dwu}c`;
        return {
          label: skuName,
          value: skuName
        };
      });
      const picked = await vscode.window.showQuickPick(options, {
        placeHolder: "Select a new performance level (DWU)"
      });
      if (!picked) {
        return;
      }

      // Confirmation prompt before scaling
      const confirmBtn = "Scale";
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to scale ${item.name} to ${picked.value}?`,
        { modal: true },
        confirmBtn
      );
      if (confirm !== confirmBtn) {
        vscode.window.showInformationMessage(`Scaling operation for ${item.name} was cancelled.`);
        return;
      }

      const { exec } = require("child_process");
      const cliCommand = `az sql dw update --name ${item.name} --resource-group ${item.resourceGroup} --server ${normalizedServer} --service-objective ${picked.value}`;
      const psCommand = `Set-AzSqlDatabase -ResourceGroupName '${item.resourceGroup}' -ServerName '${normalizedServer}' -DatabaseName '${item.name}' -RequestedServiceObjectiveName '${picked.value}'`;

      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Scaling ${item.name} to ${picked.value}...` }, async () => {
        return new Promise<void>((resolve) => {
          // Try Azure CLI first
          exec(cliCommand, (cliError: any, cliStdout: string, cliStderr: string) => {
            if (!cliError) {
              vscode.window.showInformationMessage(`Scaled ${item.name} to ${picked.value} via Azure CLI.`);
              provider.refresh();
              resolve();
              return;
            }
            // If CLI fails, try PowerShell
            exec(psCommand, { shell: "powershell.exe" }, (psError: any, psStdout: string, psStderr: string) => {
              if (!psError) {
                vscode.window.showInformationMessage(`Scaled ${item.name} to ${picked.value} via Azure PowerShell.`);
                provider.refresh();
              } else {
                let message = `Failed to scale ${item.name} with both Azure CLI and PowerShell.\nCLI error: ${cliStderr || cliError.message}\nPowerShell error: ${psStderr || psError.message}`;
                if ((cliStderr && (cliStderr.includes("ProvisioningDisabled") || cliStderr.includes("deprecated") || cliStderr.includes("Gen1"))) ||
                    (psStderr && (psStderr.includes("ProvisioningDisabled") || psStderr.includes("deprecated") || psStderr.includes("Gen1")))) {
                  message +=
                    "\nThis may be a deprecated Gen1 Data Warehouse or a region restriction. " +
                    "If you believe scaling should be allowed, try scaling in the Azure Portal or with PowerShell (Set-AzSqlDatabase). " +
                    "If the problem persists, contact Azure support.";
                }
                vscode.window.showErrorMessage(message);
              }
              resolve();
            });
          });
        });
      });
    })
  );
  // Load all subscriptions with error handling for missing credentials
  let subs = [];
  try {
    const subClient = new SubscriptionClient(credential);
    for await (const sub of subClient.subscriptions.list()) {
      if (sub.subscriptionId && sub.displayName) {
        subs.push({ subscriptionId: sub.subscriptionId, displayName: sub.displayName });
      }
    }
    if (subs.length === 0) {
      throw new Error("No Azure subscriptions found.");
    }
  } catch (err: any) {
    // Check if Azure CLI is installed
    const exec = require('child_process').exec;
    exec('az --version', async (error: any) => {
      if (error) {
        // Azure CLI not installed
        const installBtn = "Install Azure CLI";
        const selection = await vscode.window.showErrorMessage(
          "Could not authenticate to Azure. Azure CLI is not installed. Click below to install it.",
          installBtn
        );
        if (selection === installBtn) {
          vscode.env.openExternal(vscode.Uri.parse("https://docs.microsoft.com/cli/azure/install-azure-cli"));
        }
      } else {
        // Azure CLI is installed but not logged in
        const loginBtn = "Login to Azure";
        const selection = await vscode.window.showErrorMessage(
          "Could not authenticate to Azure. Azure CLI is installed, but you are not logged in. Run 'az login' in your terminal.",
          loginBtn
        );
        if (selection === loginBtn) {
          vscode.window.showInformationMessage("Open a terminal and run 'az login' to authenticate.");
        }
      }
    });
    return;
  }

  // Create a SqlManagementClient for each subscription
  const sqlClients = subs.map(s => ({
    subscriptionId: s.subscriptionId,
    displayName: s.displayName,
    sqlClient: new SqlManagementClient(credential, s.subscriptionId)
  }));

  // Pass icon path to WarehouseProvider
  const iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "DataWarehouseLogo.svg");
  const provider = new WarehouseProvider(sqlClients, iconPath);
  vscode.window.registerTreeDataProvider("warehouseView", provider);

  // Periodically check warehouse statuses and refresh UI only if changed
  let lastWarehouseStates: Record<string, string> = {};
  async function checkWarehouseStatesAndRefreshIfChanged() {
    // Gather current warehouse states
    const currentStates: Record<string, string> = {};
    for (const clientObj of sqlClients) {
      const sqlClient = clientObj.sqlClient;
      const servers = await sqlClient.servers.list();
      for await (const server of servers) {
        // Extract resource group from server.id
        const resourceGroupMatch = server.id?.match(/resourceGroups\/([^/]+)/i);
        const resourceGroup = resourceGroupMatch ? resourceGroupMatch[1] : undefined;
        if (!resourceGroup) {
          continue;
        }
        const dbs = await sqlClient.databases.listByServer(resourceGroup, server.name!);
        for await (const db of dbs) {
          if (db.sku?.tier === "DataWarehouse" && db.name) {
            const key = `${clientObj.subscriptionId}|${server.name}|${resourceGroup}|${db.name}`;
            currentStates[key] = db.status || "";
          }
        }
      }
    }
    // Compare with last states
    const changed = Object.keys(currentStates).length !== Object.keys(lastWarehouseStates).length ||
      Object.keys(currentStates).some(key => currentStates[key] !== lastWarehouseStates[key]);
    if (changed) {
      provider.refresh();
    }
    lastWarehouseStates = currentStates;
  }

  // Set up interval for status checking (every 60 seconds)
  const interval = setInterval(() => {
    checkWarehouseStatesAndRefreshIfChanged();
  }, 60000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  // Register Refresh command for the view title button
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.refreshWarehouses", () => {
      provider.refresh();
    })
  );

  // Register Pause command
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.pauseWarehouse", async (item: WarehouseItem) => {
      if (!(item instanceof WarehouseItem)) {
        return;
      }
      const sqlClientObj = sqlClients.find(s => s.subscriptionId === item.subscriptionId);
      if (!sqlClientObj) {
        vscode.window.showErrorMessage("Could not find SQL client for this subscription.");
        return;
      }
      const sqlClient = sqlClientObj.sqlClient;
      const normalizedServer = item.server.replace(/\.database\.windows\.net$/i, "");
      try {
        provider.setPendingStatus(normalizedServer, item.resourceGroup, item.name, "Pausing");
        await sqlClient.databases.beginPauseAndWait(item.resourceGroup, normalizedServer, item.name);
        vscode.window.showInformationMessage(`Paused ${item.name}`);
        provider.clearPendingStatus(normalizedServer, item.resourceGroup, item.name);
        // Force refresh to update status and show correct button
        provider.refresh();
      } catch (err: any) {
        provider.clearPendingStatus(normalizedServer, item.resourceGroup, item.name);
        // Force refresh to update status and show correct button
        provider.refresh();
        vscode.window.showErrorMessage(`Failed to pause ${item.name}: ${err.message}`);
      }
    })
  );

  // Register Resume command
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.resumeWarehouse", async (item: WarehouseItem) => {
      if (!(item instanceof WarehouseItem)) {
        return;
      }
      const sqlClientObj = sqlClients.find(s => s.subscriptionId === item.subscriptionId);
      if (!sqlClientObj) {
        vscode.window.showErrorMessage("Could not find SQL client for this subscription.");
        return;
      }
      const sqlClient = sqlClientObj.sqlClient;
      const normalizedServer = item.server.replace(/\.database\.windows\.net$/i, "");
      try {
        provider.setPendingStatus(normalizedServer, item.resourceGroup, item.name, "Resuming");
        await sqlClient.databases.beginResumeAndWait(item.resourceGroup, normalizedServer, item.name);
        vscode.window.showInformationMessage(`Resumed ${item.name}`);
        provider.clearPendingStatus(normalizedServer, item.resourceGroup, item.name);
      } catch (err: any) {
        provider.clearPendingStatus(normalizedServer, item.resourceGroup, item.name);
        vscode.window.showErrorMessage(`Failed to resume ${item.name}: ${err.message}`);
      }
    })
  );
}

// No longer need selectSubscription; all subscriptions are loaded automatically
