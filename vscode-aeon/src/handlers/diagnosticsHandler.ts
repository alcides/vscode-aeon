import { Diagnostic, DiagnosticCollection, Disposable, languages, OutputChannel, Uri } from 'vscode'

export class DiagnosticsHandler implements Disposable {
    private editorOutputChannel: OutputChannel
    private diagnosticCollection: DiagnosticCollection

    constructor(editorOutputChannel: OutputChannel) {
        this.editorOutputChannel = editorOutputChannel
        this.diagnosticCollection = languages.createDiagnosticCollection('aeon')
    }

    public updateDiagnostics(uri: Uri, diagnostics: Diagnostic[]): void {
        this.diagnosticCollection.set(uri, diagnostics)
    }

    dispose(): void {
        this.diagnosticCollection.dispose()
    }

}
