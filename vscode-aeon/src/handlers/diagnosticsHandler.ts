import { commands, Disposable, OutputChannel, Uri, window } from 'vscode'

export class DiagnosticsHandler implements Disposable {
    private subscriptions: Disposable[] = []

    constructor(editorOutputChannel: OutputChannel) {
        //TODO
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }

}