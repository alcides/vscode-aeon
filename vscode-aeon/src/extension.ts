// based on https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample which
// has this copyright:
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.

 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode'
import { AeonServices, createAllServices } from './utils/handlerUtils'

let aeonServices: AeonServices | undefined

export async function activate(context: vscode.ExtensionContext) {
    aeonServices = createAllServices(context)
    await aeonServices.aeonClient.start()

    context.subscriptions.push(aeonServices.aeonClient)
    context.subscriptions.push(aeonServices.aeonInstallationHandler)
    context.subscriptions.push(aeonServices.editorOutputChannel)
    context.subscriptions.push(aeonServices.diagnosticsHandler)
    context.subscriptions.push(aeonServices.projectHandler)
}

export function deactivate() {
}
