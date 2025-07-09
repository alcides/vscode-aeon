import * as os from 'node:os'
import * as path from 'node:path'
import { commands, ExtensionContext, OutputChannel, window } from 'vscode'
import { AeonClient } from '../aeonClient'
import { PATH, setProcessEnvPATH } from '../aeonPath'
import { AeonInstallationHandler } from '../handlers/aeonInstallationHandler'
import { DiagnosticsHandler } from '../handlers/diagnosticsHandler'
import { ProjectHandler } from '../handlers/projectHandler'
import { UriHandler } from '../handlers/uriHandler'
import { PathProvider } from '../pathProvider'
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

export interface AeonBackgroundServices {
    projectHandler: ProjectHandler
    editorOutputChannel: OutputChannel
    aeonInstallationHandler: AeonInstallationHandler
    diagnosticsHandler: DiagnosticsHandler
}

export interface AeonServices extends AeonBackgroundServices {
    aeonClient: AeonClient
}

export function activateBackgroundServices(context: ExtensionContext): AeonBackgroundServices {
    injectUvIntoSystemPath()
    context.subscriptions.push(new PathProvider())

    context.subscriptions.push(
        commands.registerCommand('aeon.showSetupGuide', () =>
            commands.executeCommand('workbench.action.openWalkthrough', 'AlcidesFonseca.aeon-lang#aeon.welcome', false),
        ),
        /*commands.registerCommand('aeon.troubleshooting.showTroubleshootingGuide', () =>
            commands.executeCommand(
                'workbench.action.openWalkthrough',
                { category: 'aeon.welcome', step: 'aeon.welcome.help' },
                false,
            ),
        ),*/
        commands.registerCommand('aeon.showDocResources', () =>
            commands.executeCommand('simpleBrowser.show', 'https://alcides.github.io/aeon/'),
        ),
    )

    const editorOutputChannel = window.createOutputChannel('Aeon: Editor')
    context.subscriptions.push(
        commands.registerCommand('aeon.troubleshooting.showOutput', () => editorOutputChannel.show(true)),
    )

    const aeonInstallationHandler = new AeonInstallationHandler(editorOutputChannel)
    context.subscriptions.push(
        commands.registerCommand(
            'aeon.setup.installUv',
            async () => await aeonInstallationHandler.displayInstallUvPrompt(),
        ),
        commands.registerCommand(
            'aeon.setup.updateUv',
            async () => await aeonInstallationHandler.displayUpdateUvPrompt(),
        ),
        commands.registerCommand(
            'aeon.setup.uninstallUv',
            async () => await aeonInstallationHandler.displayUninstallUvPrompt(),
        ),
    )

    const projectHandler = new ProjectHandler(editorOutputChannel, aeonInstallationHandler)
    context.subscriptions.push(projectHandler)

    const diagnosticsHandler = new DiagnosticsHandler(editorOutputChannel)
    context.subscriptions.push(diagnosticsHandler)

    const uriHandler = new UriHandler()
    context.subscriptions.push(uriHandler)

    return {
        projectHandler,
        editorOutputChannel,
        aeonInstallationHandler,
        diagnosticsHandler,
    }
}

async function checkAeonPrerequisites(
    aeonInstallationHandler: AeonInstallationHandler,
    context: string,
    fileResource: FileResource | undefined,
    diagnosticsHandler: DiagnosticsHandler,
) {}
