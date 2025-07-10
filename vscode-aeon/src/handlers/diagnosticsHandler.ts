import { commands, Disposable, OutputChannel, Uri, window } from 'vscode'

export class DiagnosticsHandler implements Disposable {
    private editorOutputChannel: OutputChannel

    constructor(editorOutputChannel: OutputChannel) {
        this.editorOutputChannel =  editorOutputChannel;
    }

    dispose(): void {
    }

}