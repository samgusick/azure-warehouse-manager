import * as vscode from "vscode";
import { WarehouseProvider, WarehouseItem } from "./warehouseProvider";
import { credential } from "./azureAuth";
import { SqlManagementClient } from "@azure/arm-sql";
import { SubscriptionClient } from "@azure/arm-subscriptions";

export async function activate(context: vscode.ExtensionContext) {
  // Load all subscriptions
  const subClient = new SubscriptionClient(credential);
  const subs = [];
  for await (const sub of subClient.subscriptions.list()) {
    if (sub.subscriptionId && sub.displayName) {
      subs.push({ subscriptionId: sub.subscriptionId, displayName: sub.displayName });
    }
  }
  if (subs.length === 0) {
    vscode.window.showErrorMessage("No Azure subscriptions found. Extension will not activate.");
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
