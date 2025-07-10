import * as vscode from 'vscode'
import { workspace } from 'vscode'
import * as path from 'node:path'

export function envPath(context: vscode.ExtensionContext): string {
    const configInterpreterPath: string | undefined = vscode.workspace.getConfiguration('aeon').get('interpreterPath')
    if (configInterpreterPath) {
        return configInterpreterPath
    }

    return path.join(context.globalStorageUri.fsPath, 'interpreter')
}