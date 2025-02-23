// based on https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample which
// has this copyright:
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.

 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { workspace } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    Executable,
} from 'vscode-languageclient/node';
import * as path from 'path'
import * as fs from 'fs'

let client: LanguageClient;

const AEON_DIR = path.join(__dirname, 'aeon');
const VENV_PYTHON = path.join(__dirname, '.venv', 'bin', 'python');

function isPythonAvailable(pythonPath: string): boolean {
    try {
        child_process.execFileSync(pythonPath, ['--version'],{ stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function makeLanguageServerClient() {
    const serverExecutable: Executable = {
        command: VENV_PYTHON,
        args: ['-m', 'aeon','-lsp']
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'aeon' }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.ae'),
        },
    };

    return new LanguageClient(
        'aeon',
        'Aeon',
        serverExecutable,
        clientOptions
    );
}

async function shortDelay() {
    return new Promise((resolve) => setTimeout(resolve, 1000));
}

function isUvAvailable(): boolean {
    try {
        child_process.execSync('uv --help', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function setupEnvironment(outputChannel: vscode.OutputChannel) {
    try {
        if (!fs.existsSync(AEON_DIR)) {
            outputChannel.appendLine('cloning aeon repository...');
            child_process.execSync(`git clone https://github.com/alcides/aeon.git "${AEON_DIR}"`, {
                stdio: 'inherit'
            });
        }

        child_process.execSync('git checkout lsp-mode', { // needed for now
            cwd: AEON_DIR,
            stdio: 'inherit'
        });

        if (!fs.existsSync(VENV_PYTHON)) {
            outputChannel.appendLine('creating virtual environment...');
            child_process.execSync('uv venv .venv', {
                cwd: AEON_DIR,
                stdio: 'inherit'
            });
        }

        outputChannel.appendLine('installing Aeon...');
        child_process.execSync('source .venv/bin/activate', {
            cwd: AEON_DIR,
            stdio: 'inherit'
        });

        child_process.execSync('pip install -e .', {
            cwd: AEON_DIR,
            stdio: 'inherit'
        });

    } catch (error) {
        outputChannel.appendLine(`setup failed: ${error instanceof Error ? error.message : error}`);
        throw error;
    }
}

export async function activate(context : vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('aeon');
    const pythonPath = config.get('python.executable') as string;
    const outputChannel = vscode.window.createOutputChannel('aeon diagnostics');
    outputChannel.show(true);

    try {
        if (!isPythonAvailable(pythonPath)) throw Error(`python not found at ${pythonPath}`);
        if (!isUvAvailable()) throw Error('uv not installed');

        await setupEnvironment(outputChannel);
        client = makeLanguageServerClient();
        await client.start();
        return true;
    } catch (error) {
        outputChannel.appendLine(`activation failed: ${error instanceof Error ? error.message : error}`);
        void vscode.window.showErrorMessage(
            'aeon setup failed. Check the output channel.'
        );
        return false;
    }
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}