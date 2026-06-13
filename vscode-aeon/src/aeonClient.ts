import { Disposable, OutputChannel, workspace } from 'vscode'
import { LanguageClientOptions } from 'vscode-languageclient'
import { Executable, LanguageClient, Middleware } from 'vscode-languageclient/node'
import { AeonInstallationHandler, PreConditionResult } from './handlers/aeonInstallationHandler'
import { DiagnosticsHandler } from './handlers/diagnosticsHandler'
import { NotificationHandler } from './handlers/notificationHandler'
import { localPackagePath, defaultSynthesizer } from './config'

export class AeonClient implements Disposable {
    private client: LanguageClient
    private outputChannel: OutputChannel
    private aeonInstallationHandler: AeonInstallationHandler
    private diagnosticsHandler: DiagnosticsHandler
    private notificationHandler: NotificationHandler
    private running = false

    constructor(
        aeonInstallationHandler: AeonInstallationHandler,
        diagnosticsHandler: DiagnosticsHandler,
    ) {
        this.aeonInstallationHandler = aeonInstallationHandler
        this.diagnosticsHandler = diagnosticsHandler
        this.outputChannel = aeonInstallationHandler.getOutputChannel()
        this.notificationHandler = aeonInstallationHandler.getNotificationHandler()

        const serverExecutable: Executable = this.getServerExecutable(aeonInstallationHandler)
        const clientOptions: LanguageClientOptions = this.getClientOptions()
        this.client = new LanguageClient('aeon', 'Aeon', serverExecutable, clientOptions)
    }

    private getClientOptions() {
        const middleware: Middleware = {
            handleDiagnostics: (uri, diagnostics, next) => {
                this.diagnosticsHandler.updateDiagnostics(uri, diagnostics)
                next(uri, diagnostics)
            },
            provideCodeActions: async (document, range, context, token, next) => {
                const actions = await next(document, range, context, token)
                if (!Array.isArray(actions)) return actions
                const preferred = defaultSynthesizer()
                return [...actions].sort((a, b) => {
                    const aTitle = 'title' in a ? (a.title as string) : ''
                    const bTitle = 'title' in b ? (b.title as string) : ''
                    const aMatch = aTitle.includes(`with ${preferred}`) ? -1 : 0
                    const bMatch = bTitle.includes(`with ${preferred}`) ? 1 : 0
                    return aMatch + bMatch
                })
            },
        }
        return {
            documentSelector: [{ language: 'aeon' }],
            synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.ae') },
            outputChannel: this.outputChannel,
            middleware: middleware,
        }
    }

    private getServerExecutable(aeonInstallationHandler: AeonInstallationHandler) {
        const pkgPath = localPackagePath()
        if (pkgPath) {
            return {
                command: "uvx",
                args: ['--from', pkgPath, 'aeon', '--language-server-mode'],
            }
        }
        return {
            command: "uvx",
            args: ['--refresh', '--from', 'aeonlang', 'aeon', '--language-server-mode'],
        }
    }

    async restart(): Promise<void> {
        if (this.running) {
            this.outputChannel.appendLine('Stopping Aeon language server...')
            await this.client.stop()
            this.running = false
        }
        await this.start()
    }

    async start(): Promise<void> {
        if (this.running) return

        const arePreconditionsMet: PreConditionResult = await this.aeonInstallationHandler.checkPreConditions()
        if (!arePreconditionsMet.success) {
            //possibly redirect to the guide in order to install the pre-conditions
            await this.notificationHandler.showError(`Some Pre-Condition were not met : ${arePreconditionsMet.errors}`)
            return
        }

        await this.notificationHandler.runWithProgress('Starting Aeon language server...', async () => {
            this.outputChannel.appendLine('Starting Aeon language server...')
            await this.client.start()
            void this.notificationHandler.showInformation('Aeon language server started successfully.')
            this.running = true
        })
    }

    dispose(): void {
        if (this.running) {
            void this.client.stop()
            this.running = false
        }
    }
}
