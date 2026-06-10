import { workspace } from 'vscode'

export interface AbbreviationConfig {
    /** Whether the `\`-driven Unicode input method is enabled. */
    enabled: boolean
    /** The character that starts an abbreviation (the "leader"). Defaults to `\`. */
    leader: string
    /**
     * When true, an abbreviation is replaced as soon as it is unambiguous (no longer
     * abbreviation has it as a prefix), without waiting for a terminator. Mimics Lean's
     * eager replacement.
     */
    eager: boolean
}

export function getAbbreviationConfig(): AbbreviationConfig {
    const config = workspace.getConfiguration('aeon.input')
    const leader = config.get<string>('leader', '\\')
    return {
        enabled: config.get<boolean>('enabled', true),
        // A leader must be exactly one character; fall back to `\` otherwise.
        leader: leader.length === 1 ? leader : '\\',
        eager: config.get<boolean>('eagerReplacement', true),
    }
}
