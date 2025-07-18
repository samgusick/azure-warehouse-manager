import { AzurePowerShellCredential, ChainedTokenCredential, DefaultAzureCredential, EnvironmentCredential, ManagedIdentityCredential, WorkloadIdentityCredential } from "@azure/identity";

// Export a credential for Azure SDK clients
export const credential = new DefaultAzureCredential();
