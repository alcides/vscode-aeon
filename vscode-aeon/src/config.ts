import * as vscode from 'vscode'
import { workspace } from 'vscode'
import * as path from 'node:path'

export function envPath(context: vscode.ExtensionContext): string {
    const configInterpreterPath: string | undefined = vscode.workspace.getConfiguration('aeon').get('environmentPath')
    if (configInterpreterPath && configInterpreterPath.trim() !== '') {
        return configInterpreterPath
    }

    return path.join(context.globalStorageUri.fsPath, 'interpreter')
}

export function useSystemInterpreter(): boolean {
    const useSystemInterpreter: boolean | undefined = vscode.workspace.getConfiguration('aeon')
        .get('useSystemInterpreter')

    return useSystemInterpreter === true
}

export function localPackagePath(): string {
    const p: string | undefined = vscode.workspace.getConfiguration('aeon').get('localPackagePath')
    return p?.trim() ?? ''
}

export function defaultSynthesizer(): string {
    const s: string | undefined = vscode.workspace.getConfiguration('aeon').get('defaultSynthesizer')
    return s?.trim() || 'gp'
}

/**
 * Build the command + args used to invoke the `aeon` program (via `uvx`),
 * honouring the `aeon.localPackagePath` setting. `extraArgs` are appended after
 * the `aeon` subcommand, e.g. `['--language-server-mode']` or `['--format', file]`.
 */
export function aeonExecutable(extraArgs: string[]): { command: string; args: string[] } {
    const pkgPath = localPackagePath()
    if (pkgPath) {
        return { command: 'uvx', args: ['--from', pkgPath, 'aeon', ...extraArgs] }
    }
    return { command: 'uvx', args: ['--refresh', '--from', 'aeonlang', 'aeon', ...extraArgs] }
}
