// based on https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample which
// has this copyright:
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.

 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { workspace } from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import {
    LanguageClient,
    LanguageClientOptions,
    Executable,
} from 'vscode-languageclient/node';

let client: LanguageClient;

const AEON_DIR = 'aeon';
const VENV_DIR = 'venv';
const VENV_PYTHON = path.join(VENV_DIR, 'bin', 'python');

function isPythonInstalled(pythonPath: string): boolean {
    try {
        child_process.execFileSync(pythonPath, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function isAeonInstalled(pythonPath: string): boolean {
    try {
        child_process.execFileSync(pythonPath, ['-c', 'import aeon'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function makeLanguageServerClient() {
    const serverExecutable: Executable = {
        command: path.join(__dirname, VENV_PYTHON),
        args: ['-m', 'aeon', '-lsp']
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'aeon' }],
        synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.ae'), },
    };

    return new LanguageClient(
        'aeon',
        'Aeon',
        serverExecutable,
        clientOptions
    );
}

async function execCommand(command: string, cwd: string, outputChannel: vscode.OutputChannel): Promise<void> {
    return new Promise((resolve, reject) => {
        child_process.exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function executeWithSpecialErrorHandling(
    command: string,
    cwd: string,
    outputChannel: vscode.OutputChannel,
    customError: Error
): Promise<void> {
    try {
        await execCommand(command, cwd, outputChannel);
    } catch (error) {
        throw customError;
    }
}


async function setupEnvironment(outputChannel: vscode.OutputChannel): Promise<void> {
    const extensionPath = __dirname;
    const aeonPath = path.join(extensionPath, AEON_DIR);
    const venvPythonPath = path.join(extensionPath, VENV_PYTHON);

    try {
        if (fs.existsSync(aeonPath)) {
            await execCommand('git pull origin lsp-mode', aeonPath, outputChannel);
        } else {
            await execCommand(
                `git clone https://github.com/alcides/aeon.git "${AEON_DIR}"`,
                extensionPath,
                outputChannel
            );
        }
        await execCommand('git checkout lsp-mode', aeonPath, outputChannel); // will not be needed

        await execCommand(
            `python3 -m venv --clear "${VENV_DIR}"`,
            extensionPath,
            outputChannel
        );

        await execCommand(
            `"${venvPythonPath}" -m pip install -e .`,
            aeonPath,
            outputChannel
        );

        if (!isAeonInstalled(venvPythonPath)) {
            throw new Error('failed to install aeon');
        }

        outputChannel.appendLine('setup complete');
    } catch (error) { //TODO use executeWithSpecialErrorHandling for each case
                      //     that needs to be special and handle them separately
        throw error;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('aeon');
    const pythonPath = config.get('python.executable') as string;
    const outputChannel = vscode.window.createOutputChannel('Aeon Diagnostics');
    outputChannel.show(true);

    try {
        if (!isPythonInstalled(pythonPath)) {
            throw new Error(`python not found at ${pythonPath}`);
        }

        await setupEnvironment(outputChannel);

        client = makeLanguageServerClient();
        context.subscriptions.push(client);
        await client.start();

        outputChannel.appendLine('Aeon language server started successfully');
        return true;
    } catch (error) {
        void vscode.window.showErrorMessage('aeon setup failed');
        return false;
    }
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}