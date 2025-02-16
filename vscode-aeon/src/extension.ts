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
    Executable
} from 'vscode-languageclient';

let client: LanguageClient;

interface Settings {
    python: {
        executable: string;
    };
}

/**
 * Check if our egg is already installed on this python.
 *
 * @param python path of the python interpreter
 */
function isExtensionInstalled(python: string): boolean {
    try {
        child_process.execFileSync(python, ['-m', 'aeon', '-lsp']); //TODO add a flag to verify if everything looks good
        return true;
    } catch {
        return false;
    }
}
/**
 * Check if python version looks supported.
 *
 * @param python path of the python interpreter
 */
function isPythonVersionCompatible(python: string): boolean {
    try {
        child_process.execFileSync(python, [
            '-c',
            'import sys; sys.exit(sys.version_info[:2] < (3, 6))'
        ]);
        return true;
    } catch {
        return false;
    }
}

async function shortDelay() {
    return new Promise(resolve => setTimeout(resolve, 1000));
}

export async function activate() {
    const executablePath: any = vscode.workspace
        .getConfiguration()
        .get('aeon.python.executable');

    const settings: Settings = {
        python: {
            executable: executablePath
        }
    };

    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aeon.python.executable')) {
            void vscode.window.showInformationMessage(
                'New Python selected (' + executablePath + '): needs application restart'
            );
        }
    });

    const serverExecutable: Executable = {
        command: settings.python.executable,
        args: ['-m', 'aeon', '-lsp'].concat(
            vscode.workspace.getConfiguration().get('aeon.language.server.arguments') || []
        )
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'aeon' }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.ae')
        }
    };

    if (!isPythonVersionCompatible(settings.python.executable)) {
        void vscode.window.showErrorMessage(
            'Aeon extension: Invalid Python version, needs Python >= 3.6'
        );
        return false;
    }

    // Check if we are properly installed on the selected Python
    let installationOK = isExtensionInstalled(settings.python.executable);
    if (!installationOK) {
        const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Aeon language server is not installed on ${settings.python.executable}. Install now?`
        });

        if (answer !== 'Yes') {
            return false;
        }

        const terminal = vscode.window.createTerminal('Aeon');
        terminal.show(false);
        terminal.sendText('# Installing Aeon language server on selected Python\n');
        terminal.sendText(`${settings.python.executable} -m pip install --user -e "${executablePath}"`);

        for (let retries = 0; retries < 5; retries++) {
            await shortDelay();
            installationOK = isExtensionInstalled(settings.python.executable);
            if (installationOK) break;
        }

        if (!installationOK) {
            void vscode.window.showErrorMessage('Aeon extension: Could not install language server');
            return false;
        }

        void vscode.window.showInformationMessage('Aeon extension: Installed language server');
    }

    client = new LanguageClient('aeon', 'Aeon Language Server', serverExecutable, clientOptions);
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
