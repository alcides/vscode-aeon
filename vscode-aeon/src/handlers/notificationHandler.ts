import * as vscode from 'vscode'
import { MessageOptions, window } from 'vscode'

export class NotificationHandler {
    async showError(message: string) {
        await window.showErrorMessage(message)
    }

    async showChoice(
        message: string,
        choices: Record<string, () => Promise<void> | void>,
        options?: MessageOptions,
    ): Promise<void> {
        const choiceLabels = Object.keys(choices)
        const selected = await window.showInformationMessage(message, options ?? {}, ...choiceLabels)

        if (selected && choices[selected]) {
            await choices[selected]()
        }
    }

    async showInformation(message: string) {
        await window.showInformationMessage(message)
    }

    async showWarning(message: string) {
        await window.showWarningMessage(message)
    }

    async runWithProgress<T>(
        title: string,
        task: () => Promise<T>,
        location: vscode.ProgressLocation = vscode.ProgressLocation.Notification,
        cancellable = false,
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location,
                title,
                cancellable,
            },
            async () => await task(),
        )
    }
}
