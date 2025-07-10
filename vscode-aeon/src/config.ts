import * as vscode from 'vscode'
import * as path from 'node:path'

export function envPath(context: vscode.ExtensionContext): string {
    const configInterpreterPath: string | undefined = vscode.workspace.getConfiguration('aeon').get('environmentPath')
    if (configInterpreterPath && configInterpreterPath.trim() !== '') {
        return configInterpreterPath
    }

    return path.join(context.globalStorageUri.fsPath, 'interpreter')
}

export function useSystemInterpreter(): boolean {
    const useSystemInterpreter: boolean | undefined = vscode.workspace
        .getConfiguration('aeon')
        .get('useSystemInterpreter')

    return useSystemInterpreter === true
}

export function getAeonVersion(): String {
    const DEFAULT_AEON_VERSION = 'lsp-mode'
    return vscode.workspace.getConfiguration('aeon').get('version') || DEFAULT_AEON_VERSION
}
