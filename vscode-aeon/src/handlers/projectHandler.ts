import { Disposable, OutputChannel } from 'vscode'
import { AeonInstallationHandler } from './aeonInstallationHandler'

export class ProjectHandler implements Disposable {
    private editorOutputChannel: OutputChannel
    private aeonInstallationHandler: AeonInstallationHandler

    constructor(editorOutputChannel: OutputChannel, aeonInstallationHandler: AeonInstallationHandler) {
        this.editorOutputChannel = editorOutputChannel
        this.aeonInstallationHandler = aeonInstallationHandler
    }

    dispose(): void {
    }
}
