import * as vscode from "vscode";
import { WarehouseProvider, WarehouseItem } from "./warehouseProvider";
import { credential } from "./azureAuth";
import { SqlManagementClient } from "@azure/arm-sql";
import { SubscriptionClient } from "@azure/arm-subscriptions";

export async function activate(context: vscode.ExtensionContext) {
  // Register Scale command
  context.subscriptions.push(
    vscode.commands.registerCommand("extension.scaleWarehouse", async (item: WarehouseItem) => {
      if (!(item instanceof WarehouseItem)) {
        return;
      }
      const sqlClientObj = sqlClients.find(s => s.subscriptionId === item.subscriptionId);
      if (!sqlClientObj) {
        vscode.window.showErrorMessage("Could not find SQL client for this subscription.");
        return;
      }
      const sqlClient = sqlClientObj.sqlClient;
      try {
        // List available service objectives (performance levels)
        const objectives = [];
        for await (const o of sqlClient.serviceObjectives.listByServer(item.resourceGroup, item.server)) {
          objectives.push(o);
        }
        const options = objectives
          .filter((o: any) => o.name && o.displayName)
          .map((o: any) => ({
            label: o.displayName || o.name,
            value: o.name
          }));
        if (options.length === 0) {
          vscode.window.showErrorMessage("No performance levels found for this warehouse.");
          return;
        }
        const picked = await vscode.window.showQuickPick(options, {
          placeHolder: "Select a new performance level (service objective)"
        });
        if (!picked) {
          return;
        }
        // Get current db info
        const db = await sqlClient.databases.get(item.resourceGroup, item.server, item.name);
        // Update database with new service objective
        await sqlClient.databases.beginUpdateAndWait(item.resourceGroup, item.server, item.name, {
          sku: {
            name: picked.value,
            tier: db.sku?.tier || "DataWarehouse"
          }
        });
        vscode.window.showInformationMessage(`Scaled ${item.name} to ${picked.label}`);
        provider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to scale ${item.name}: ${err.message}`);
      }
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
      try {
        provider.setPendingStatus(item.server, item.resourceGroup, item.name, "Pausing");
        await sqlClient.databases.beginPauseAndWait(item.resourceGroup, item.server, item.name);
        vscode.window.showInformationMessage(`Paused ${item.name}`);
        provider.clearPendingStatus(item.server, item.resourceGroup, item.name);
        // Force refresh to update status and show correct button
        provider.refresh();
      } catch (err: any) {
        provider.clearPendingStatus(item.server, item.resourceGroup, item.name);
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
      try {
        provider.setPendingStatus(item.server, item.resourceGroup, item.name, "Resuming");
        await sqlClient.databases.beginResumeAndWait(item.resourceGroup, item.server, item.name);
        vscode.window.showInformationMessage(`Resumed ${item.name}`);
        provider.clearPendingStatus(item.server, item.resourceGroup, item.name);
      } catch (err: any) {
        provider.clearPendingStatus(item.server, item.resourceGroup, item.name);
        vscode.window.showErrorMessage(`Failed to resume ${item.name}: ${err.message}`);
      }
    })
  );
}

// No longer need selectSubscription; all subscriptions are loaded automatically
