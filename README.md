
# Azure Warehouse Manager VS Code Extension

## Overview
Azure Warehouse Manager is a Visual Studio Code extension designed to help you manage Azure Synapse Analytics and Azure SQL Data Warehouses directly from your editor. Easily pause, resume, and monitor your data warehouses, view subscription details, and streamline your workflow with integrated Azure authentication.

## Features
- Authenticate with Azure using DefaultAzureCredential
- List and manage Azure subscriptions
- Pause and resume Azure Synapse/SQL Data Warehouses
- View warehouse status and properties
- Integrated with VS Code command palette

## Requirements
- Visual Studio Code 1.75+
- Azure CLI or Azure PowerShell installed locally
- Azure account with appropriate permissions
- Node.js 16+ (**only required if building or running from source**)

## Installation

### Pre-Requisites

Install and log in to one of the following:

**Azure CLI**  
1. Follow this [guide](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest)
2. Use PowerShell to log in:
   ```powershell
   az login
   ```

**OR**

**Azure PowerShell**  
1. Follow this [guide](https://learn.microsoft.com/en-us/powershell/azure/install-azps-windows?view=azps-14.2.0&tabs=powershell&pivots=windows-psgallery)
2. Use PowerShell to log in:
   ```powershell
   Connect-AzAccount
   ```

### Install in VS Code
1. Install from the VS Code Extension Marketplace

### Install from Source
1. Clone or download this repository.
2. Open the folder in VS Code.
3. Run `npm install` to install dependencies.
4. Press `F5` to launch the extension in a new Extension Development Host window.

## Usage
1. Open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Search for and run commands like `Azure Warehouse: Authenticate`, `Azure Warehouse: List Warehouses`, or `Azure Warehouse: Pause/Resume Warehouse`.
3. Follow prompts to authenticate and manage your Azure resources.

## Authentication
This extension uses Azure's `DefaultAzureCredential`, supporting multiple authentication methods (Visual Studio, Azure CLI, Managed Identity, etc.).

## Contributing
Pull requests and issues are welcome! Please open an issue to discuss your ideas or report bugs.

## License
MIT License