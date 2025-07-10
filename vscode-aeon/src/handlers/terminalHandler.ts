import * as child_process from 'node:child_process'
import * as os from 'node:os'
import { OutputChannel } from 'vscode'
import { CommandResult } from '../utils/commandResult'

export enum Platform {
    Unix = 'Unix',
    Windows = 'Windows',
}

export class TerminalHandler {
    private outputChannel: OutputChannel

    constructor(outputChannel: OutputChannel) {
        this.outputChannel = outputChannel
    }

    getPlatform(): Platform {
        return os.platform() === 'win32' ? Platform.Windows : Platform.Unix
    }

    async runCommand(command: string, cwd?: string): Promise<CommandResult> {
        return new Promise(resolve => {
            const child = child_process.spawn(command, { cwd, shell: true })

            let stdout = ''
            let stderr = ''

            child.stdout?.on('data', data => {
                const text = data.toString()
                stdout += text
                this.outputChannel.appendLine(text)
            })

            child.stderr?.on('data', data => {
                const text = data.toString()
                stderr += text
                this.outputChannel.appendLine(text)
            })

            child.on('close', code => {
                const success = code === 0
                resolve(
                    new CommandResult(
                        success,
                        stdout,
                        stderr,
                        code,
                        success ? undefined : new Error(`Command "${command}" exited with code ${code}`),
                    ),
                )
            })

            child.on('error', error => {
                resolve(new CommandResult(false, stdout, stderr, null, error))
            })
        })
    }
}
