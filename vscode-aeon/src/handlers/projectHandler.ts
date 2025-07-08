import { commands, Disposable, OutputChannel, Uri, window } from 'vscode'
import { AeonInstallationHandler } from './aeonInstallationHandler'

export class ProjectHandler implements Disposable {
    private subscriptions: Disposable[] = []

    constructor(editorOutputChannel: OutputChannel, aeonInstallationHandler: AeonInstallationHandler) {
        //TODO
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }

}