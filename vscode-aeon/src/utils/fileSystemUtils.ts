// @ts-ignore
import path from 'path'
import { PathLike, promises } from 'fs'


export async function isFile(filePath: PathLike): Promise<boolean> {
    try {
        return (await promises.stat(filePath)).isFile()
    } catch (e) {
        return false
    }
}

export async function isDirectory(dirPath: PathLike): Promise<boolean> {
    try {
        return (await promises.stat(dirPath)).isDirectory()
    } catch (e) {
        return false
    }
}

export function isPathInDirectory(filePath: string, directory: string) {
    const relativePath = path.relative(directory, filePath)
    const isSubpath = relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    return isSubpath
}

export function getRelativePath(filePath: string, directory: string): string | undefined {
    if (!isPathInDirectory(filePath, directory)) {
        return undefined
    }
    return path.relative(directory, filePath)
}