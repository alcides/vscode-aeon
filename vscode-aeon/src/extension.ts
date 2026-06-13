// based on https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample which
// has this copyright:
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.

 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode'
import { AeonServices, createAllServices } from './utils/handlerUtils'
import { AbbreviationFeature } from './abbreviation/abbreviationFeature'
import { InfoViewProvider } from './infoview/infoViewProvider'

let aeonServices: AeonServices | undefined

export async function activate(context: vscode.ExtensionContext) {
    // Lean-style Unicode input method (e.g. `\to` -> `→`). Registered before the
    // language client so it is available as soon as an Aeon file is opened.
    context.subscriptions.push(new AbbreviationFeature(context))

    aeonServices = createAllServices(context)
    await aeonServices.aeonClient.start()

    context.subscriptions.push(aeonServices.aeonClient)
    context.subscriptions.push(aeonServices.aeonInstallationHandler)
    context.subscriptions.push(aeonServices.editorOutputChannel)
    context.subscriptions.push(aeonServices.diagnosticsHandler)
    context.subscriptions.push(aeonServices.projectHandler)
    context.subscriptions.push(
        vscode.commands.registerCommand('aeon.restartServer', () => aeonServices!.aeonClient.restart())
    )

    // Lean-style info view: goal, expression type and typing context at the cursor.
    const infoViewProvider = new InfoViewProvider(aeonServices.aeonClient)
    context.subscriptions.push(infoViewProvider)
    context.subscriptions.push(
	vscode.commands.registerCommand('aeon.infoView.toggle', () => infoViewProvider.toggle()),
	vscode.commands.registerCommand('aeon.infoView.open', () => infoViewProvider.open()),
    )
    const autoOpen = () => vscode.workspace.getConfiguration('aeon').get<boolean>('infoView.autoOpen') === true
    if (autoOpen() && vscode.window.activeTextEditor?.document.languageId === 'aeon') {
	infoViewProvider.open()
    }
}

export function deactivate() {
}
