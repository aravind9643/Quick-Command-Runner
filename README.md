# Quick Command Runner

Save commands in folders and run them with ease from the VS Code sidebar.

## Features

- **Organize Commands** — Create commands and group them into folders
- **Run Commands** — Execute saved commands directly from the sidebar
- **Run All in Folder** — Run all active commands in a folder sequentially
- **Active/Inactive Toggle** — Disable commands without deleting them; inactive commands are skipped in "Run All"
- **Variable Substitution** — Use `${file}`, `${workspaceFolder}`, `${input:Prompt}` and more in your commands
- **Confirmation Prompts** — Optionally require confirmation before running a command
- **Custom Icons** — Set icons for commands using VS Code Codicons
- **Environment Variables** — Set per-command environment variables
- **Drag & Drop** — Reorder commands and move them between folders
- **Import/Export** — Backup and restore your commands as JSON

## Usage

1. Open the **Command Runner** view from the activity bar
2. Click **+** to add a command, or **📁** to add a folder
3. Right-click commands for options like edit, set icon, set env vars, toggle confirm, etc.
4. Click ▶ to run a command

## Variable Placeholders

| Placeholder | Description |
|---|---|
| `${file}` | Current file path |
| `${relativeFile}` | Relative file path |
| `${fileBasename}` | Current file name |
| `${workspaceFolder}` | Workspace root path |
| `${selectedText}` | Currently selected text |
| `${input:Title}` | Prompts for user input at runtime |
