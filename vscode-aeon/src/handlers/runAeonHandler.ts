import { Disposable, OutputChannel } from 'vscode';
import { TerminalHandler } from './terminalHandler';
import { NotificationHandler } from './notificationHandler';

export class RunAeonHandler implements Disposable {
    private readonly outputChannel: OutputChannel;
    private readonly terminalHandler: TerminalHandler;
    private readonly notificationHandler: NotificationHandler;

    constructor(outputChannel: OutputChannel) {
        this.outputChannel = outputChannel;
        this.terminalHandler = new TerminalHandler(outputChannel);
        this.notificationHandler = new NotificationHandler();
    }

    dispose(): void {}

    async runAeonFile(filePath: string): Promise<void> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`Running Aeon file: ${filePath}`);
        const command = `uvx --from aeonlang aeon ${filePath}`;
        await this.terminalHandler.runCommand(command);
    }
}
