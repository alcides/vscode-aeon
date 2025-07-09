export class CommandResult {
    success: boolean
    stdout: string
    stderr: string
    code: number | null
    error?: Error

    constructor(success: boolean, stdout: string, stderr: string, code: number | null, error?: Error) {
        this.success = success
        this.stdout = stdout
        this.stderr = stderr
        this.code = code
        this.error = error
    }

    getErrorMessage(message? :string): string {
        if (message) {
            return message
        }
        if (this.error) {
            return this.error.message
        }
        if (!this.success && this.stderr) {
            return this.stderr
        }
        return 'Unknown error occurred'
    }

    getSuccessMessage(message? : string): string {
        return message ? message : 'Command ran successfully.';
    }

    getMessage(successMessage? : string,errorMessage? : string): string {
        return this.success ? this.getSuccessMessage(successMessage) : this.getErrorMessage(errorMessage);
    }
}
