import { Disposable, OutputChannel } from 'vscode'
import { NotificationHandler } from './notificationHandler'
import { Platform, TerminalHandler } from './terminalHandler'
import { CommandResult } from '../utils/commandResult'
import * as os from 'node:os'
import * as path from 'path'

export class AeonInstallationHandler implements Disposable {
    private editorOutputChannel: OutputChannel
    private terminalHandler: TerminalHandler
    private notificationHandler: NotificationHandler

    constructor(editorOutputChannel: OutputChannel) {
        this.editorOutputChannel = editorOutputChannel
        this.terminalHandler = new TerminalHandler(editorOutputChannel)
        this.notificationHandler = new NotificationHandler()
    }

    dispose(): void {}

    async checkUvInstallation(): Promise<CommandResult> {
        const platform = this.terminalHandler.getPlatform();
        const command = platform === Platform.Windows
            ? 'powershell -Command "(Get-Command uv | Select-Object -First 1).Source"'
            : 'which uv';
        return await this.terminalHandler.runCommand(command);
    }

    async displayInstallUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation();
        if (uvCheckResult.success) {
            await this.notificationHandler.showError('Uv is already installed.');
            return;
        }
        await this.notificationHandler.showChoice('Uv is not installed. Would you like to install it now?', {
            Install: async () => {
                const installUvResult = await this.installUv()
                const resultMessage = installUvResult.getMessage(
                    'Successfully installed Uv',
                    'Error Installing Uv'
                )
                if (installUvResult.success) {
                    await this.notificationHandler.showInformation(resultMessage);
                }
                else  if (installUvResult.error) {
                    await this.notificationHandler.showError(resultMessage);
                }
            },
            Cancel: () => this.editorOutputChannel.appendLine('User canceled uv installation.'),
        })
    }

    async displayUpdateUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation();
        if (!uvCheckResult.success) {
            await this.notificationHandler.showError('Uv is not installed, please install it first.');
            return;
        }

        const isUvExternallyManaged = await this.isUvExternallyManaged(uvCheckResult)
        if (isUvExternallyManaged) {
            await this.notificationHandler.showError('Uv is externally managed. Update it through your package manager.');
            return;
        }

        await this.notificationHandler.showChoice('Would you like to update your Uv installation?', {
            Update: async () => {
                const updateResult = await this.updateUv();
                const resultMessage = updateResult.getMessage(
                    'Successfully updated Uv.',
                    'Failed to update Uv.'
                );
                if (updateResult.success) {
                    await this.notificationHandler.showInformation(resultMessage);
                } else if (updateResult.error) {
                    await this.notificationHandler.showError(resultMessage);
                }
            },
            Cancel: () => this.editorOutputChannel.appendLine('User canceled Uv update.')
        });
    }


    async displayUninstallUvPrompt() {
        const uvCheckResult = await this.checkUvInstallation();
        if (!uvCheckResult.success) {
            await this.notificationHandler.showWarning('Uv is not installed.');
            return;
        }

        await this.notificationHandler.showChoice('Would you like to uninstall Uv?', {
            Uninstall: async () => {
                const uninstallResult = await this.uninstallUv();
                const resultMessage = uninstallResult.getMessage(
                    'Successfully uninstalled Uv.',
                    'Failed to uninstall Uv.'
                );
                if (uninstallResult.success) {
                    await this.notificationHandler.showInformation(resultMessage);
                } else if (uninstallResult.error) {
                    await this.notificationHandler.showError(resultMessage);
                }
            },
        }, { modal: true });
    }

    private async installUv() {
        const command = this.terminalHandler.getPlatform() === Platform.Windows
            ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"\n'
            : 'curl -Ls https://astral.sh/uv/install.sh | bash\n';

        return await this.terminalHandler.runCommand(command);
    }


    private async updateUv() {
        const command = 'uv self update';
        return await this.terminalHandler.runCommand(command);
    }

    private async uninstallUv() {
        const platform = this.terminalHandler.getPlatform();

        const command = platform === Platform.Windows
            ? 'powershell -ExecutionPolicy ByPass -c ' +
            '"Remove-Item -Force ((Get-Command uv | Select-Object -First 1).Source) -ErrorAction SilentlyContinue; ' +
            'Remove-Item -Force ((Get-Command uvx | Select-Object -First 1).Source) -ErrorAction SilentlyContinue"'
            : 'rm -f $(which uv) $(which uvx)';

        return await this.terminalHandler.runCommand(command);
    }

    private getExpectedUvPath(): string {
        const homeDir = os.homedir();
        return this.terminalHandler.getPlatform() === Platform.Windows
            ? path.join(homeDir, '.local', 'bin', 'uv.exe')
            : path.join(homeDir, '.local', 'bin', 'uv');
    }

    private async isUvExternallyManaged(checkUvInstallationResult : CommandResult) : Promise<boolean> {
        const uvPathString = checkUvInstallationResult.stdout.trim().split('/\r?\n')[0]
        const expectedUvPath = this.getExpectedUvPath()

        return uvPathString.toLowerCase() !== expectedUvPath.toLowerCase()
    }
}
