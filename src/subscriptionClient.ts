import * as vscode from "vscode";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { credential } from "./azureAuth";

export async function pickAzureSubscription(): Promise<string | undefined> {
  const client = new SubscriptionClient(credential);
  const subscriptions = client.subscriptions.list();
  const subList = [];
  for await (const sub of subscriptions) {
    subList.push({ label: sub.displayName!, id: sub.subscriptionId! });
  }

  const selected = await vscode.window.showQuickPick(
    subList.map(s => s.label),
    { placeHolder: "Select an Azure subscription" }
  );

  const match = subList.find(s => s.label === selected);
  return match?.id;
}
