import { Disposable, workspace } from 'vscode'
import { envPath } from './config'
import { PATH, setProcessEnvPATH } from './aeonPath'

export class PathProvider implements Disposable {
    currentPathExtensions: PATH = PATH.empty()
    subscriptions: Disposable[] = []

    constructor() {
        this.replaceEnvPathExtensionsInPATH()
        this.subscriptions.push(
            workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('aeon.envPathExtensions')) {
                    this.replaceEnvPathExtensionsInPATH()
                }
            }),
        )
    }

    replaceEnvPathExtensionsInPATH() {
        const previousPathExtensions = this.currentPathExtensions
        this.currentPathExtensions = envPath()
        const path = PATH.ofProcessEnv()
        const originalPath = path.filter(path => !previousPathExtensions.includes(path))
        setProcessEnvPATH(this.currentPathExtensions.join(originalPath))
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
