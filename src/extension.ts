import * as vscode from 'vscode';

interface CommandEntry {
    label: string;
    command: string;
    folder?: string;
    id: string;
    confirm?: boolean;
    icon?: string;
    env?: string; // Stored as "KEY1=VAL1,KEY2=VAL2"
    active?: boolean; // undefined or true = active, false = inactive
}

interface FolderEntry {
    label: string;
    id: string;
}

async function resolveVariables(expression: string): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    let resolved = expression
        .replace(/\${file}/g, editor?.document.fileName || '')
        .replace(/\${relativeFile}/g, editor ? vscode.workspace.asRelativePath(editor.document.uri) : '')
        .replace(/\${fileBasename}/g, editor ? (editor.document.fileName.split(/[\\/]/).pop() || '') : '')
        .replace(/\${workspaceFolder}/g, workspaceFolder)
        .replace(/\${selectedText}/g, editor?.document.getText(editor.selection) || '');

    // Handle ${input:Prompt Title}
    const inputRegex = /\${input:([^}]+)}/g;
    let match;
    const inputs: { placeholder: string, title: string }[] = [];
    
    while ((match = inputRegex.exec(resolved)) !== null) {
        inputs.push({ placeholder: match[0], title: match[1] });
    }

    for (const input of inputs) {
        const val = await vscode.window.showInputBox({ prompt: `Enter value for: ${input.title}` });
        if (val === undefined) return ''; // User cancelled
        resolved = resolved.replace(input.placeholder, val);
    }

    return resolved;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new CommandTreeProvider(context);
    const view = vscode.window.createTreeView('commandRunnerView', {
        treeDataProvider: provider,
        dragAndDropController: provider,
        canSelectMany: true
    });
    view.description = '✋ Drag to reorder • Right-click for options';

    context.subscriptions.push(
        view,
        vscode.commands.registerCommand('commandRunner.refresh', () => {
            provider.refresh();
        }),

        vscode.commands.registerCommand('commandRunner.addCommand', async () => {
            const cmd = await vscode.window.showInputBox({ 
                prompt: 'Enter command string',
                placeHolder: 'e.g. git commit -m "${input:Message}" or npm run ${input:Script}'
            });
            
            const label = await vscode.window.showInputBox({ 
                prompt: 'Enter entry name', 
                value: cmd || '',
                placeHolder: 'e.g. Commit with Prompt or Run Custom Script'
            });
            if (!label) return;

            const newCommand: CommandEntry = {
                label,
                command: cmd || '',
                folder: undefined,
                id: Date.now().toString()
            };

            provider.addCommand(newCommand);
        }),

        vscode.commands.registerCommand('commandRunner.addCommandToFolder', async (item: CommandTreeItem) => {
            if (!item.entry || 'command' in item.entry) return;
            const folderLabel = item.entry.label;

            const cmd = await vscode.window.showInputBox({ 
                prompt: `Enter command string (folder: ${folderLabel})`,
                placeHolder: 'e.g. git commit -m "${input:Message}" or npm run ${input:Script}'
            });
            
            const label = await vscode.window.showInputBox({ 
                prompt: 'Enter entry name', 
                value: cmd || '',
                placeHolder: 'e.g. Commit with Prompt or Run Custom Script'
            });
            if (!label) return;

            const newCommand: CommandEntry = {
                label,
                command: cmd || '',
                folder: folderLabel,
                id: Date.now().toString()
            };

            provider.addCommand(newCommand);
        }),

        vscode.commands.registerCommand('commandRunner.addFolder', async () => {
            const label = await vscode.window.showInputBox({ prompt: 'Enter folder name' });
            if (!label) return;

            provider.addFolder({ label, id: Date.now().toString() });
        }),

        vscode.commands.registerCommand('commandRunner.runCommand', async (item: CommandTreeItem) => {
            if (item.entry && 'command' in item.entry) {
                runCommandLogic(item.entry, provider, context);
            }
        }),

        vscode.commands.registerCommand('commandRunner.runCommandById', async (id: string) => {
            const cmd = provider.getCommands().find(c => c.id === id);
            if (cmd) await runCommandLogic(cmd, provider, context);
        }),

        vscode.commands.registerCommand('commandRunner.runAllInFolder', async (item: CommandTreeItem) => {
            if (item.entry && !('command' in item.entry)) {
                const commands = provider.getCommands().filter(c => c.folder === item.entry.label && c.active !== false);
                for (const cmd of commands) {
                    await runCommandLogic(cmd, provider, context);
                }
            }
        }),

        vscode.commands.registerCommand('commandRunner.setIcon', async (item: CommandTreeItem) => {
            if (item.entry && 'command' in item.entry) {
                const iconOptions = [
                    { label: '$(rocket)', description: 'rocket', id: 'rocket' },
                    { label: '$(database)', description: 'database', id: 'database' },
                    { label: '$(bug)', description: 'bug', id: 'bug' },
                    { label: '$(play)', description: 'play', id: 'play' },
                    { label: '$(sync)', description: 'sync/refresh', id: 'sync' },
                    { label: '$(gear)', description: 'gear/settings', id: 'gear' },
                    { label: '$(zap)', description: 'zap/bolt', id: 'zap' },
                    { label: '$(flame)', description: 'flame/fire', id: 'flame' },
                    { label: '$(star)', description: 'star', id: 'star' },
                    { label: '$(heart)', description: 'heart', id: 'heart' },
                    { label: '$(terminal)', description: 'terminal', id: 'terminal' },
                    { label: 'Custom...', description: 'Enter a custom Codicon ID', id: 'custom' }
                ];
                const selected = await vscode.window.showQuickPick(iconOptions);
                if (!selected) return;
                let iconId = selected.id;
                if (iconId === 'custom') {
                    iconId = await vscode.window.showInputBox({ prompt: 'Enter Codicon ID' }) || '';
                }
                provider.updateCommand(item.entry.id, { icon: iconId });
            }
        }),

        vscode.commands.registerCommand('commandRunner.setEnv', async (item: CommandTreeItem) => {
            if (item.entry && 'command' in item.entry) {
                const env = await vscode.window.showInputBox({ 
                    prompt: 'Enter Env Vars (e.g. PORT=3000,DEBUG=true)',
                    value: item.entry.env || ''
                });
                if (env !== undefined) provider.updateCommand(item.entry.id, { env: env || undefined });
            }
        }),

        vscode.commands.registerCommand('commandRunner.toggleActive', (item: CommandTreeItem) => {
            if (item.entry && 'command' in item.entry) {
                const current = item.entry.active !== false;
                provider.updateCommand(item.entry.id, { active: !current });
            }
        }),

        vscode.commands.registerCommand('commandRunner.toggleConfirm', item => provider.updateCommand(item.entry.id, { confirm: !item.entry.confirm })),

        vscode.commands.registerCommand('commandRunner.editEntry', async (item: CommandTreeItem) => {
            if (!item.entry) return;
            if ('command' in item.entry) {
                const label = await vscode.window.showInputBox({ prompt: 'Edit name', value: item.entry.label });
                if (!label) return;
                const cmd = await vscode.window.showInputBox({ prompt: 'Edit command', value: item.entry.command });
                provider.updateCommand(item.entry.id, { label, command: cmd || '' });
            } else {
                const label = await vscode.window.showInputBox({ prompt: 'Edit folder name', value: item.entry.label });
                if (label) provider.updateFolder(item.entry.id, label);
            }
        }),

        vscode.commands.registerCommand('commandRunner.deleteEntry', async (item: CommandTreeItem) => {
            if (!item.entry) return;
            const confirm = await vscode.window.showWarningMessage(`Delete "${item.entry.label}"?`, 'Yes', 'No');
            if (confirm === 'Yes') {
                provider.deleteEntry(item.entry);
            }
        }),

        vscode.commands.registerCommand('commandRunner.export', async () => {
            const commands = provider.getCommands();
            const folders = provider.getFolders();

            // Build nested structure
            const nested: any[] = [];

            // Add folders with their commands nested inside
            for (const folder of folders) {
                const folderCmds = commands.filter(c => c.folder === folder.label);
                nested.push({
                    type: 'folder',
                    label: folder.label,
                    id: folder.id,
                    commands: folderCmds
                });
            }

            // Add root-level commands (no folder)
            const rootCmds = commands.filter(c => !c.folder || !folders.some(f => f.label === c.folder));
            for (const cmd of rootCmds) {
                nested.push({ type: 'command', ...cmd });
            }

            const path = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file('commands-backup.json'), filters: { 'JSON': ['json'] } });
            if (path) {
                await vscode.workspace.fs.writeFile(path, Buffer.from(JSON.stringify(nested, null, 2)));
                vscode.window.showInformationMessage('Exported successfully!');
            }
        }),

        vscode.commands.registerCommand('commandRunner.import', async () => {
            const path = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'JSON': ['json'] } });
            if (path?.[0]) {
                const content = await vscode.workspace.fs.readFile(path[0]);
                const data = JSON.parse(content.toString());

                if (Array.isArray(data)) {
                    const folders: FolderEntry[] = [];
                    const commands: CommandEntry[] = [];

                    for (const item of data) {
                        if (item.type === 'folder') {
                            folders.push({ label: item.label, id: item.id });
                            if (item.commands) {
                                for (const cmd of item.commands) {
                                    commands.push({ ...cmd, folder: item.label });
                                }
                            }
                        } else if (item.type === 'command') {
                            const { type, ...cmd } = item;
                            commands.push(cmd);
                        }
                    }

                    context.globalState.update('commands', commands);
                    context.globalState.update('folders', folders);
                    provider.refresh();
                    vscode.window.showInformationMessage('Imported successfully!');
                } else {
                    vscode.window.showErrorMessage('Invalid format. Expected a nested JSON array.');
                }
            }
        })
    );
}

async function runCommandLogic(entry: CommandEntry, provider: CommandTreeProvider, context: vscode.ExtensionContext) {
    if (entry.confirm) {
        const confirm = await vscode.window.showWarningMessage(`Run "${entry.label}"?`, 'Yes', 'No');
        if (confirm !== 'Yes') return;
    }

    // 1. Run "Self" (if not empty)
    if (entry.command.trim()) {
        const resolvedCmd = await resolveVariables(entry.command);
        if (!resolvedCmd) return; // User cancelled an input prompt
        const env: Record<string, string> = {};
        if (entry.env) {
            entry.env.split(',').forEach(pair => {
                const [k, v] = pair.split('=');
                if (k && v) env[k.trim()] = v.trim();
            });
        }

        const terminal = vscode.window.terminals.find(t => t.name === 'Command Runner') || vscode.window.createTerminal({ name: 'Command Runner', env });

        terminal.show();
        terminal.sendText(resolvedCmd);
    }

}

class CommandTreeProvider implements vscode.TreeDataProvider<CommandTreeItem>, vscode.TreeDragAndDropController<CommandTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CommandTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    dropMimeTypes = ['application/vnd.code.tree.commandRunnerView'];
    dragMimeTypes = ['text/uri-list'];

    constructor(private context: vscode.ExtensionContext) {}

    refresh() { this._onDidChangeTreeData.fire(); }
    getTreeItem(element: CommandTreeItem) { return element; }

    async getChildren(element?: CommandTreeItem): Promise<CommandTreeItem[]> {
        const commands = this.getCommands();
        const folders = this.getFolders();
        if (element) {
            if (element.entry && !('command' in element.entry)) {
                return commands.filter(c => c.folder === element.entry.label).map(c => {
                    return new CommandTreeItem(c, vscode.TreeItemCollapsibleState.None);
                });
            }
            return [];
        } else {
            const items: CommandTreeItem[] = [];
            items.push(...folders.map(f => new CommandTreeItem(f, vscode.TreeItemCollapsibleState.Collapsed)));
            items.push(...commands.filter(c => (!c.folder || !folders.some(f => f.label === c.folder))).map(c => {
                return new CommandTreeItem(c, vscode.TreeItemCollapsibleState.None);
            }));
            return items;
        }
    }

    getCommands(): CommandEntry[] { return this.context.globalState.get<CommandEntry[]>('commands', []); }
    getFolders(): FolderEntry[] { return this.context.globalState.get<FolderEntry[]>('folders', []); }
    addCommand(cmd: CommandEntry) { const c = this.getCommands(); c.push(cmd); this.context.globalState.update('commands', c); this.refresh(); }
    updateCommand(id: string, update: Partial<CommandEntry>) { const c = this.getCommands().map(x => x.id === id ? { ...x, ...update } : x); this.context.globalState.update('commands', c); this.refresh(); }
    addFolder(f: FolderEntry) { const folders = this.getFolders(); folders.push(f); this.context.globalState.update('folders', folders); this.refresh(); }
    updateFolder(id: string, newLabel: string) {
        const folders = this.getFolders();
        const old = folders.find(f => f.id === id);
        if (!old) return;
        const updated = folders.map(f => f.id === id ? { ...f, label: newLabel } : f);
        this.context.globalState.update('folders', updated);
        const cmds = this.getCommands().map(c => c.folder === old.label ? { ...c, folder: newLabel } : c);
        this.context.globalState.update('commands', cmds);
        this.refresh();
    }
    deleteEntry(entry: CommandEntry | FolderEntry) {
        if ('command' in entry) {
            const cmds = this.getCommands().filter(c => c.id !== entry.id);
            this.context.globalState.update('commands', cmds);
        } else {
            const f = this.getFolders().filter(x => x.id !== entry.id);
            this.context.globalState.update('folders', f);
            const c = this.getCommands().map(x => x.folder === entry.label ? { ...x, folder: undefined } : x);
            this.context.globalState.update('commands', c);
        }
        this.refresh();
    }

    handleDrag(source: CommandTreeItem[], dataTransfer: vscode.DataTransfer) { dataTransfer.set('application/vnd.code.tree.commandRunnerView', new vscode.DataTransferItem(source)); }
    async handleDrop(target: CommandTreeItem | undefined, dataTransfer: vscode.DataTransfer) {
        const item = dataTransfer.get('application/vnd.code.tree.commandRunnerView');
        if (!item) return;
        const sources: CommandTreeItem[] = item.value;
        const commands = this.getCommands();

        // Standard item movement / reordering logic
        let targetFolder: string | undefined = undefined;
        let targetIndex = -1;

        if (target) {
            if ('entry' in target && target.entry) {
                if (!('command' in target.entry)) {
                    // Dropped on a Folder
                    targetFolder = target.entry.label;
                } else {
                    // Dropped on a Command (Reorder)
                    targetFolder = target.entry.folder;
                    targetIndex = commands.findIndex(c => c.id === target.entry.id);
                }
            }
        }

        // 1. Change folder for all moved items
        let newCommands = [...commands];
        const movedIds = sources.map(s => s.entry.id);
        
        newCommands = newCommands.map(c => movedIds.includes(c.id) ? { ...c, folder: targetFolder } : c);

        // 2. If targetIndex was found, reorder them in the array
        if (targetIndex !== -1) {
            const movedItems = newCommands.filter(c => movedIds.includes(c.id));
            newCommands = newCommands.filter(c => !movedIds.includes(c.id));
            // Recalculate targetIndex after removing moved items
            const newTargetIndex = newCommands.findIndex(c => c.id === (target!.entry as CommandEntry).id);
            newCommands.splice(newTargetIndex, 0, ...movedItems);
        }

        this.context.globalState.update('commands', newCommands);
        this.refresh();
    }
}

class CommandTreeItem extends vscode.TreeItem {
    constructor(public readonly entry: CommandEntry | FolderEntry, public readonly collapsibleState: vscode.TreeItemCollapsibleState) {
        super(entry.label, collapsibleState);
        if ('command' in entry) {
            const d: string[] = [];
            if (entry.confirm) d.push('⚠️');
            if (entry.env) d.push('🔐');
            const isActive = entry.active !== false;
            if (!isActive) {
                d.push('[inactive]');
            }
            this.description = d.join(' ');
            this.tooltip = entry.command;
            this.iconPath = new vscode.ThemeIcon(
                entry.icon || 'terminal',
                isActive ? undefined : new vscode.ThemeColor('disabledForeground')
            );
            this.contextValue = isActive ? 'command' : 'commandInactive';
            // Removing default command to prevent run on label click
            // this.command = { command: 'commandRunner.runCommand', title: 'Run', arguments: [this] };
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'commandRunnerFolder';
        }
        this.id = entry.id;
    }
}
