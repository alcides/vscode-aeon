import { commands, ExtensionContext, extensions, OutputChannel, TextDocument, window, workspace } from 'vscode'
import { PathProvider } from '../pathProvider'
import { UriHandler } from '../handlers/uriHandler'
import { AeonClient } from '../aeonClient'
import { ProjectHandler } from '../handlers/projectHandler'
import { AeonInstallationHandler } from '../handlers/aeonInstallationHandler'
import { DiagnosticsHandler } from '../handlers/diagnosticsHandler'
import { UvCommandHandler } from '../handlers/uvCommandHandler'
import { PATH, setProcessEnvPATH } from '../aeonPath'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileResource } from './supportedUri'

function injectUvIntoSystemPath() {
    const path = PATH.ofProcessEnv()
    const uvPath = getUvPath()
    if (!path.includes(uvPath)) {
        setProcessEnvPATH(path.prepend(uvPath))
    }
}

function getUvPath(): string {
    return path.join(os.homedir(), '.uv', 'bin')
}

function getDefaultAeonVersion() {
    //TODO
}

export interface AeonBackgroundServices {
    projectHandler : ProjectHandler,
    editorOutputChannel: OutputChannel
    aeonInstallationHandler: AeonInstallationHandler
    diagnosticsHandler: DiagnosticsHandler
    uvCommandHandler: UvCommandHandler
}

export interface AeonServices extends AeonBackgroundServices{
    aeonClient : AeonClient,
}

function activateBackgroundServices(context: ExtensionContext): AeonBackgroundServices {
    injectUvIntoSystemPath()
    context.subscriptions.push(new PathProvider())

    context.subscriptions.push(
        commands.registerCommand('aeon.docs.showSetupGuide', () =>
            commands.executeCommand('workbench.action.openWalkthrough', 'aeon.welcome', false),
        ),
        commands.registerCommand('aeon.troubleshooting.showTroubleshootingGuide', () =>
            commands.executeCommand(
                'workbench.action.openWalkthrough',
                { category: 'aeon.welcome', step: 'aeon.welcome.help' },
                false,
            ),
        ),
        commands.registerCommand('aeon.docs.showDocResources', () =>
            commands.executeCommand('simpleBrowser.show', 'https://alcides.github.io/aeon/'),
        ),
    )

    const editorOutputChannel = window.createOutputChannel('Aeon: Editor')
    context.subscriptions.push(
        commands.registerCommand('aeon.troubleshooting.showOutput', () => editorOutputChannel.show(true)),
    )

    const defaultToolchain = getDefaultAeonVersion()
    const aeonInstallationHandler = new AeonInstallationHandler(editorOutputChannel, defaultToolchain)
    context.subscriptions.push(
        commands.registerCommand(
            'aeon.setup.installUv',
            async () => await aeonInstallationHandler.displayInstallUvPrompt('Information'),
        ),
        commands.registerCommand(
            'aeon.setup.updateUv',
            async () => await aeonInstallationHandler.displayManualUpdateUvPrompt(),
        ),
        commands.registerCommand('aeon.setup.uninstallUv', async () => await aeonInstallationHandler.uninstallUv()),
    )

    const projectHandler = new ProjectHandler(editorOutputChannel, aeonInstallationHandler)
    context.subscriptions.push(projectHandler)

    const diagnosticsHandler = new DiagnosticsHandler(editorOutputChannel)
    context.subscriptions.push(diagnosticsHandler)

    const uvCommandHandler = new UvCommandHandler(editorOutputChannel)
    context.subscriptions.push(uvCommandHandler)

    const uriHandler = new UriHandler()
    context.subscriptions.push(uriHandler)

    return {
        projectHandler,
        editorOutputChannel,
        aeonInstallationHandler,
        diagnosticsHandler,
        uvCommandHandler,
    }
}

async function checkAeonPrerequisites(
    aeonInstallationHandler: AeonInstallationHandler,
    context: string,
    fileResource: FileResource | undefined,
    diagnosticsHandler: DiagnosticsHandler,
){

}
