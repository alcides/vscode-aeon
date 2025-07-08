// @ts-ignore
import path from 'path'
import { Uri, workspace } from 'vscode'
import { isPathInDirectory , getRelativePath } from './fileSystemUtils'

function unsupportedSchemeError(uri: Uri): Error {
    return new Error(`Got URI with unsupported scheme '${uri.scheme}': '${uri}'`)
}

export class FileResource {
    scheme: 'file'
    fsPath: string

    constructor(fsPath: string) {
        this.scheme = 'file'
        this.fsPath = fsPath
    }

    static fromUri(uri: Uri): FileResource | undefined {
        return uri.scheme === 'file' ? new FileResource(uri.fsPath) : undefined
    }

    static fromUriOrThrow(uri: Uri): FileResource {
        const result = this.fromUri(uri)
        if (!result) throw unsupportedSchemeError(uri)
        return result
    }

    asUri(): Uri {
        return Uri.file(this.fsPath)
    }

    equals(other: FileResource): boolean {
        return this.fsPath === other.fsPath
    }

    equalsUri(other: Uri): boolean {
        const otherFile = FileResource.fromUri(other)
        return !!otherFile && this.equals(otherFile)
    }

    toString(): string {
        return this.asUri().toString()
    }

    baseName(): string {
        return path.basename(this.fsPath)
    }

    join(...segments: string[]): FileResource {
        return FileResource.fromUriOrThrow(Uri.joinPath(this.asUri(), ...segments))
    }

    isInFolder(folder: FileResource): boolean {
        return isPathInDirectory(this.fsPath, folder.fsPath)
    }

    relativeTo(folder: FileResource): FileResource | undefined {
        const relativePath = getRelativePath(this.fsPath, folder.fsPath)
        return relativePath ? new FileResource(relativePath) : undefined
    }
}

export class UntitledResource {
    scheme: 'untitled'
    path: string

    constructor(path: string = '') {
        this.scheme = 'untitled'
        this.path = path
    }

    static fromUri(uri: Uri): UntitledResource | undefined {
        return uri.scheme === 'untitled' ? new UntitledResource(uri.path) : undefined
    }

    static fromUriOrThrow(uri: Uri): UntitledResource {
        const result = this.fromUri(uri)
        if (!result) throw unsupportedSchemeError(uri)
        return result
    }

    asUri(): Uri {
        return Uri.from({ scheme: 'untitled', path: this.path })
    }

    equals(other: UntitledResource): boolean {
        return this.path === other.path
    }

    equalsUri(other: Uri): boolean {
        const otherUntitled = UntitledResource.fromUri(other)
        return !!otherUntitled && this.equals(otherUntitled)
    }

    toString(): string {
        return this.asUri().toString()
    }
}


export type SupportedUri = FileResource | UntitledResource

export function isSupportedUri(uri: Uri): boolean {
    return uri.scheme === 'file' || uri.scheme === 'untitled'
}

export function toSupportedUri(uri: Uri): SupportedUri | undefined {
    return uri.scheme === 'file'
        ? new FileResource(uri.fsPath)
        : uri.scheme === 'untitled'
            ? new UntitledResource(uri.path)
            : undefined
}

export function requireSupportedUri(uri: Uri): SupportedUri {
    const result = toSupportedUri(uri)
    if (!result) throw unsupportedSchemeError(uri)
    return result
}

export function parseSupportedUri(uriStr: string): SupportedUri | undefined {
    return toSupportedUri(Uri.parse(uriStr))
}

export function requireParsedSupportedUri(uriStr: string): SupportedUri {
    return requireSupportedUri(Uri.parse(uriStr))
}

export function areUrisEqual(a: SupportedUri, b: SupportedUri): boolean {
    return a.scheme === b.scheme && a.equals(b as any)
}

export function asFileResource(uri: SupportedUri): FileResource | undefined {
    return uri.scheme === 'file' ? uri : undefined
}


export function isInWorkspace(uri: FileResource): boolean {
    return workspace.getWorkspaceFolder(uri.asUri()) !== undefined
}

export function isWorkspaceRoot(uri: FileResource): boolean {
    return workspace.workspaceFolders?.some(f => uri.equalsUri(f.uri)) ?? false
}
