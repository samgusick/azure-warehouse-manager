import * as vscode from "vscode";
import { SqlManagementClient } from "@azure/arm-sql";

export class WarehouseProvider implements vscode.TreeDataProvider<WarehouseItem | SubscriptionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WarehouseItem | SubscriptionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Map key: server|resourceGroup|name, value: pending status ("Resuming" or "Pausing")
  private pendingStatus = new Map<string, string>();

  constructor(
    private sqlClients: { subscriptionId: string, displayName: string, sqlClient: SqlManagementClient }[],
    private warehouseIconPath?: vscode.Uri
  ) {}

  private makeKey(server: string, resourceGroup: string, name: string): string {
    return `${server}|${resourceGroup}|${name}`;
  }

  setPendingStatus(server: string, resourceGroup: string, name: string, status: "Resuming" | "Pausing") {
    this.pendingStatus.set(this.makeKey(server, resourceGroup, name), status);
    this.refresh();
  }

  clearPendingStatus(server: string, resourceGroup: string, name: string) {
    this.pendingStatus.delete(this.makeKey(server, resourceGroup, name));
    this.refresh();
  }

  async getChildren(element?: SubscriptionItem | WarehouseItem): Promise<(SubscriptionItem | WarehouseItem)[]> {
    if (!element) {
      // Top level: return subscriptions
      return this.sqlClients.map(
        s => new SubscriptionItem(s.displayName, s.subscriptionId)
      );
    }

    if (element instanceof SubscriptionItem) {
      // Children: warehouses for this subscription
      const sqlClientObj = this.sqlClients.find(s => s.subscriptionId === element.subscriptionId);
      if (!sqlClientObj) {
        return [];
      }
      const sqlClient = sqlClientObj.sqlClient;
      const items: WarehouseItem[] = [];
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
          if (db.sku?.tier === "DataWarehouse") {
            const key = this.makeKey(server.name!, resourceGroup, db.name!);
            const pending = this.pendingStatus.get(key);
            const status = pending ? pending : db.status!;
            items.push(new WarehouseItem(db.name!, status, server.name!, resourceGroup, element.subscriptionId));
          }
        }
      }
      return items;
    }

    // No children for WarehouseItem
    return [];
  }

  getTreeItem(element: WarehouseItem | SubscriptionItem): vscode.TreeItem {
    // If it's a WarehouseItem, set the iconPath if not pending
    if (element instanceof WarehouseItem && this.warehouseIconPath) {
      if (element.status !== "Resuming" && element.status !== "Pausing") {
        element.iconPath = this.warehouseIconPath;
      }
    }
    return element;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}

export class SubscriptionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly subscriptionId: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "subscription";
    this.iconPath = new vscode.ThemeIcon("azure");
  }
}

export class WarehouseItem extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly status: string,
    public readonly server: string,
    public readonly resourceGroup: string,
    public readonly subscriptionId: string,
    public readonly skuName?: string
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.description = status;

    // Tooltip with warehouse details and DWU
    let dwu = "";
    if (skuName && skuName.startsWith("DW")) {
      dwu = skuName.replace("DW", "");
    }
    this.tooltip = `Warehouse: ${name}\nStatus: ${status}\nServer: ${server}\nResource Group: ${resourceGroup}\nSubscription: ${subscriptionId}${dwu ? `\nDWU: ${dwu}` : ""}`;

    // Set context value for context menu and button visibility
    const resumedStates = ["Resumed", "Online", "Available"];
    if (resumedStates.includes(status)) {
      this.contextValue = "warehouse-resumed";
    } else if (status === "Paused") {
      this.contextValue = "warehouse-paused";
    } else {
      this.contextValue = "warehouse-pending";
    }

    // Show a spinning icon if status is Resuming or Pausing
    if (status === "Resuming" || status === "Pausing") {
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    }
    // iconPath for normal state is set by WarehouseProvider.getTreeItem
  }
}
