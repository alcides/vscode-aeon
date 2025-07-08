import { workspace } from 'vscode'
import { PATH } from './aeonPath'

export function envPath(): PATH {
    return new PATH(workspace.getConfiguration('aeon').get('envPath', []))
}