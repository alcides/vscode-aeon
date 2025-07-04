// based on https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample which
// has this copyright:
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.

 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode'
import { workspace } from 'vscode'
import * as child_process from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

import {LanguageClientOptions} from 'vscode-languageclient'
import {LanguageClient, Executable} from 'vscode-languageclient/node'

let client: LanguageClient

const AEON_DIR = 'aeon'

const VENV_DIR = 'venv'
const VENV_PYTHON = path.join(VENV_DIR, process.platform === 'win32' ? 'Scripts' : 'bin', 'python')

const USE_LOCAL_INTERPRETER = false;
const LOCAL_INTERPRETER_PATH = '/my_folder/';

class AeonNotInstalledError extends Error {
}

class GitCloneError extends Error {
}

class GitNotInstalledError extends Error {
}

class PythonNotInstalledError extends Error {
}

class VenvExecutableError extends Error {
}

function isPythonInstalled(pythonPath: string): boolean {
    try {
        child_process.execFileSync(pythonPath, ['--version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

function isGitInstalled(): boolean {
    try {
        child_process.execFileSync('git', ['--version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

function isAeonInstalled(pythonPath: string): boolean {
    try {
        child_process.execFileSync(pythonPath, ['-c', 'import aeon'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

function makeLanguageServerClient() {
    const serverExecutable: Executable = {
        command: path.join(__dirname, VENV_PYTHON),
        args: ['-m', 'aeon', '-lsp']
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'aeon' }],
        synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.ae') }
    }

    return new LanguageClient(
        'aeon',
        'Aeon',
        serverExecutable,
        clientOptions
    )
}

async function execCommand(command: string, cwd: string, outputChannel: vscode.OutputChannel, customError: Error): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = child_process.spawn(command, { cwd, shell: true })

        child.stdout?.on('data', (data) => outputChannel.appendLine(data.toString()))
        child.stderr?.on('data', (data) => outputChannel.appendLine(data.toString()))

        child.on('close', (code) => {
            if (code !== 0) {
                reject(customError)
            } else {
                resolve()
            }
        })

        child.on('error', () => reject(customError))
    })
}

async function handleNotInstalledErr(programName: string, downloadUrl: string) {
    const selection = await vscode.window.showInformationMessage(
        `${programName} is not installed or could not be found. Would you like to install it again?`,
        'Install', 'Cancel'
    );

    if (selection === 'Install') {
        await vscode.env.openExternal(vscode.Uri.parse(downloadUrl));

        const restartSelection = await vscode.window.showInformationMessage(
            `After installing ${programName}, restart VSCode to continue.`,
            'Restart VS Code'
        );

        if (restartSelection === 'Restart VS Code') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}

async function setupEnvironment(outputChannel: vscode.OutputChannel,
                                pythonPath: string): Promise<void> {
    const extensionPath = __dirname
    const aeonPath = USE_LOCAL_INTERPRETER && LOCAL_INTERPRETER_PATH
        ? LOCAL_INTERPRETER_PATH
        : path.join(extensionPath, AEON_DIR)
    const venvPythonPath = path.join(extensionPath, VENV_PYTHON)

    try {
        if (!isPythonInstalled(pythonPath)) {
            throw new PythonNotInstalledError()
        }
        if (!isGitInstalled()) {
            throw new GitNotInstalledError()
        }

        if (!USE_LOCAL_INTERPRETER) {
            if (fs.existsSync(aeonPath)) {
                await execCommand('git pull origin lsp-mode-sync',
                    aeonPath,
                    outputChannel,
                    new GitCloneError())
            } else {
                await execCommand(
                    `git clone https://github.com/alcides/aeon.git "${aeonPath}"`,
                    extensionPath,
                    outputChannel,
                    new GitCloneError()
                )
            }

            await execCommand('git checkout lsp-mode-sync',
                aeonPath,
                outputChannel,
                new GitCloneError())
        }

        await execCommand(
            `python3 -m venv --clear "${VENV_DIR}"`,
            extensionPath,
            outputChannel,
            new PythonNotInstalledError()
        )

        await execCommand(
            `"${venvPythonPath}" -m pip install -e .`,
            aeonPath,
            outputChannel,
            new VenvExecutableError()
        )

        if (!isAeonInstalled(venvPythonPath)) {
            throw new AeonNotInstalledError()
        }

        outputChannel.appendLine('setup complete')
    } catch (error) {
        const err = error as Error
        if (err instanceof PythonNotInstalledError) {
            await handleNotInstalledErr('Python', 'https://www.python.org/downloads/')
        } else if (err instanceof GitNotInstalledError) {
            await handleNotInstalledErr('Git', 'https://git-scm.com/downloads')
        } else if (err instanceof GitCloneError) {
            void vscode.window.showErrorMessage('Failed to clone the Aeon repository.')
        } else if (err instanceof VenvExecutableError) {
            void vscode.window.showErrorMessage('Failed to install dependencies with VENV')
        } else if (err instanceof AeonNotInstalledError) {
            void vscode.window.showErrorMessage('Failed to install Aeon')
        } else {
            void vscode.window.showErrorMessage(`Unexpected setup error: ${err.message}`)
        }
        throw err
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('aeon')
    const pythonPath = config.get('python.executable') as string
    const outputChannel = vscode.window.createOutputChannel('Aeon Diagnostics')
    outputChannel.show(true)
    try {
        await setupEnvironment(outputChannel, pythonPath)
        client = makeLanguageServerClient()
        context.subscriptions.push(client)
        await client.start()
        outputChannel.appendLine('Aeon language server started successfully')
        return true
    } catch (error) {
        void vscode.window.showErrorMessage('Aeon setup failed')
        return false
    }
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined
    }
    return client.stop()
}