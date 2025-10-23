import { Disposable, OutputChannel, workspace } from 'vscode'
import { LanguageClientOptions } from 'vscode-languageclient'
import { Executable, LanguageClient } from 'vscode-languageclient/node'
import { AeonInstallationHandler, PreConditionResult } from './handlers/aeonInstallationHandler'
import { NotificationHandler } from './handlers/notificationHandler'

export class AeonClient implements Disposable {
    private client: LanguageClient
    private outputChannel: OutputChannel
    private aeonInstallationHandler: AeonInstallationHandler
    private notificationHandler: NotificationHandler
    private running = false

    constructor(
        aeonInstallationHandler: AeonInstallationHandler,
    ) {
        this.aeonInstallationHandler = aeonInstallationHandler
        this.outputChannel = aeonInstallationHandler.getOutputChannel()
        this.notificationHandler = aeonInstallationHandler.getNotificationHandler()

        const serverExecutable: Executable = this.getServerExecutable(aeonInstallationHandler)
        const clientOptions: LanguageClientOptions = this.getClientOptions()
        this.client = new LanguageClient('aeon', 'Aeon', serverExecutable, clientOptions)
    }

    private getClientOptions() {
        return {
            documentSelector: [{ language: 'aeon' }],
            synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.ae') },
        }
    }

    private getServerExecutable(aeonInstallationHandler: AeonInstallationHandler) {
        return {
            command: aeonInstallationHandler.getAeonExecutablePath(),
            args: ['--from', 'aeonlang', 'aeon', '--lsp'],
        }
    }

    async start(): Promise<void> {
        if (this.running) return

        const arePreconditionsMet: PreConditionResult = await this.aeonInstallationHandler.checkPreConditions()
        if (!arePreconditionsMet.success) {
            //possibly redirect to the guide in order to install the pre-conditions
            await this.notificationHandler.showError(`Some Pre-Condition were not met : ${arePreconditionsMet.errors}`)
            return
        }

        await this.notificationHandler.runWithProgress('Setting up Aeon...', async () => {
            await this.aeonInstallationHandler.setupAeon()
        })

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
