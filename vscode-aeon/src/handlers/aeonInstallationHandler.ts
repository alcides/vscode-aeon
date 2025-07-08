import { commands, Disposable, OutputChannel, Uri, window } from 'vscode'

export class AeonInstallationHandler implements Disposable {
    private subscriptions: Disposable[] = []

    constructor(editorOutputChannel: OutputChannel, defaultToolchain: void) {
        //TODO
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }

    async displayInstallUvPrompt(information: string) {
        //TODO
    }

    async displayManualUpdateUvPrompt() {
        //TODO
    }

    async uninstallUv() {
        //TODO
    }
}