import * as os from 'node:os'
import * as path from 'path'
import {Disposable, OutputChannel} from 'vscode'
import {CommandResult} from '../utils/commandResult'
import {NotificationHandler} from './notificationHandler'
import {Platform, TerminalHandler} from './terminalHandler'
import {useSystemInterpreter} from "../config";


export interface PreConditionResult {
    success: boolean
    errors: string[]
}

export class AeonInstallationHandler implements Disposable {
    private readonly editorOutputChannel: OutputChannel
    private terminalHandler: TerminalHandler
    private readonly notificationHandler: NotificationHandler
    private readonly envPath: string

    constructor(editorOutputChannel: OutputChannel, envPath: string) {
        this.editorOutputChannel = editorOutputChannel
        this.terminalHandler = new TerminalHandler(editorOutputChannel)
        this.notificationHandler = new NotificationHandler()
        this.envPath = envPath
    }

    dispose(): void {
    }

    getAeonExecutablePath(): string {
        const platform = this.terminalHandler.getPlatform()
        const exeName = platform === Platform.Windows ? 'aeon.exe' : 'aeon'

        if (useSystemInterpreter()) {
            return exeName
        }

        const exeDirectory = platform === Platform.Windows ? 'Scripts' : 'bin'
        return path.join(this.envPath, exeDirectory, exeName)
    }

    getPythonExecutablePath(): string {
        const platform = this.terminalHandler.getPlatform()
        const exeDirectory = platform === Platform.Windows ? 'Scripts' : 'bin'
        const pythonExe = platform === Platform.Windows ? 'python.exe' : 'python'
        return path.join(this.envPath, exeDirectory, pythonExe)
    }

    async checkUvInstallation(): Promise<CommandResult> {
        const platform = this.terminalHandler.getPlatform()
        const command = platform === Platform.Windows ? 'where /f uv' : 'which uv'
        return await this.terminalHandler.runCommand(command)
    }

    async checkGitInstallation(): Promise<CommandResult> {
        const command = 'git --version'
        return await this.terminalHandler.runCommand(command)
    }

    async checkAeonInstallation(): Promise<CommandResult> {
        const executable = this.getAeonExecutablePath()
        const command = `${executable} -h`
        return await this.terminalHandler.runCommand(command)
    }

    async setupAeon(): Promise<CommandResult> {
        const venvResult = await this.createNewPythonEnvironment()
        if (!venvResult.success) {
            void this.notificationHandler.showError(`Failed to create virtual environment: ${venvResult.stderr}`)
            throw new Error('Venv creation failed')
        }
        void this.notificationHandler.showInformation('Virtual environment created successfully.')

        const installResult = await this.installAeon()
        if (!installResult.success) {
            void this.notificationHandler.showError(`Failed to install Aeon: ${installResult.stderr}`)
            throw new Error('Aeon installation failed')
        }
        void this.notificationHandler.showInformation('Aeon installed successfully.')
        return installResult
    }


    async installAeon(): Promise<CommandResult> {
        const AEON_REPOSITORY = 'git+https://github.com/alcides/aeon.git'
        const AEON_VERSION = 'lsp-mode-sync'

        const pythonPath = this.getPythonExecutablePath()
        const command = `uv pip install --python "${pythonPath}" "${AEON_REPOSITORY}@${AEON_VERSION}"`
        return await this.terminalHandler.runCommand(command)
    }

    async createNewPythonEnvironment(): Promise<CommandResult> {
        const command = `uv venv "${this.envPath}"`
        return await this.terminalHandler.runCommand(command)
    }

    async displayInstallUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation()
        if (uvCheckResult.success) {
            void this.notificationHandler.showError('Uv is already installed.')
            return
        }
        await this.notificationHandler.showChoice('Uv is not installed. Would you like to install it now?', {
            Install: async () => {
                const installUvResult = await this.notificationHandler.runWithProgress('Installing Uv...', () =>
                    this.installUv(),
                )
                const resultMessage = installUvResult.getMessage('Successfully installed Uv', 'Error Installing Uv')
                if (installUvResult.success) {
                    void this.notificationHandler.showInformation(resultMessage)
                } else if (installUvResult.error) {
                    void this.notificationHandler.showError(resultMessage)
                }
            },
            Cancel: () => this.editorOutputChannel.appendLine('User canceled uv installation.'),
        })
    }

    async displayUpdateUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation()
        if (!uvCheckResult.success) {
            void this.notificationHandler.showError('Uv is not installed, please install it first.')
            return
        }

        const isUvExternallyManaged = await this.isUvExternallyManaged(uvCheckResult)
        if (isUvExternallyManaged) {
            void this.notificationHandler.showError(
                'Uv is externally managed. Update it through your package manager.',
            )
            return
        }

        await this.notificationHandler.showChoice('Would you like to update your Uv installation?', {
            Update: async () => {
                const updateResult = await this.notificationHandler.runWithProgress('Updating Uv...', () =>
                    this.updateUv(),
                )
                const resultMessage = updateResult.getMessage('Successfully updated Uv.', 'Failed to update Uv.')
                if (updateResult.success) {
                    void this.notificationHandler.showInformation(resultMessage)
                } else if (updateResult.error) {
                    void this.notificationHandler.showError(resultMessage)
                }
            },
            Cancel: () => this.editorOutputChannel.appendLine('User canceled Uv update.'),
        })
    }

    async displayUninstallUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation()
        if (!uvCheckResult.success) {
            void this.notificationHandler.showWarning('Uv is not installed.')
            return
        }

        await this.notificationHandler.showChoice(
            'Would you like to uninstall Uv?',
            {
                Uninstall: async () => {
                    const uninstallResult = await this.notificationHandler.runWithProgress('Uninstalling Uv...', () =>
                        this.uninstallUv(),
                    )
                    const resultMessage = uninstallResult.getMessage(
                        'Successfully uninstalled Uv.',
                        'Failed to uninstall Uv.',
                    )
                    if (uninstallResult.success) {
                        void this.notificationHandler.showInformation(resultMessage)
                    } else if (uninstallResult.error) {
                        void this.notificationHandler.showError(resultMessage)
                    }
                },
            },
            {modal: true},
        )
    }

    private async installUv() {
        const command =
            this.terminalHandler.getPlatform() === Platform.Windows
                ? 'powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"'
                : 'curl -Ls https://astral.sh/uv/install.sh | bash'

        return await this.terminalHandler.runCommand(command)
    }

    private async updateUv() {
        const command = 'uv self update'
        return await this.terminalHandler.runCommand(command)
    }

    private async uninstallUv() {
        const platform = this.terminalHandler.getPlatform()

        const command =
            platform === Platform.Windows
                ? 'powershell -ExecutionPolicy Bypass -c "' +
                'Remove-Item -Force ((Get-Command uv | Select-Object -First 1).Source) -ErrorAction SilentlyContinue; ' +
                'Remove-Item -Force ((Get-Command uvx | Select-Object -First 1).Source) -ErrorAction SilentlyContinue"'
                : 'rm -f $(which uv) $(which uvx)'

        return await this.terminalHandler.runCommand(command)
    }

    private getExpectedUvPath(): string {
        const homeDir = os.homedir()
        return this.terminalHandler.getPlatform() === Platform.Windows
            ? path.join(homeDir, '.local', 'bin', 'uv.exe')
            : path.join(homeDir, '.local', 'bin', 'uv')
    }

    private async isUvExternallyManaged(checkUvInstallationResult: CommandResult): Promise<boolean> {
        let uvPathString = checkUvInstallationResult.stdout.trim().split('/\r?\n')[0]
        const expectedUvPath = this.getExpectedUvPath()

        if (uvPathString.startsWith('"') && uvPathString.endsWith('"')) {
            uvPathString = uvPathString.slice(1, -1)
        }

        return uvPathString.toLowerCase() !== expectedUvPath.toLowerCase()
    }

    async checkPreConditions(): Promise<PreConditionResult> {
        const errors: string[] = []

        const [git, uv] = await Promise.all([this.checkGitInstallation(), this.checkUvInstallation()])

        if (!git.success) errors.push('Git is not installed or not available in PATH.')
        if (!uv.success) errors.push('Uv is not installed or not available in PATH.')

        return {
            success: errors.length === 0,
            errors,
        }
    }

    getOutputChannel() {
        return this.editorOutputChannel
    }

    getNotificationHandler() {
        return this.notificationHandler
    }
}
