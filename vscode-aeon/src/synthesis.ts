import type { CodeAction, Command } from 'vscode'
import aliases from './synthesisAliases.json'

/** Wire format shared with aeon/infoView. The server owns labels and ordering. */
export interface SynthesizerInfo {
    id: string
    label: string
    family: string
}

/** Preserve every server-provided backend, including newly added families. */
export function groupSynthesizers(synthesizers: readonly SynthesizerInfo[]): Map<string, SynthesizerInfo[]> {
    const groups = new Map<string, SynthesizerInfo[]>()
    for (const synthesizer of synthesizers) {
        const family = synthesizer.family || 'Other'
        const group = groups.get(family) ?? []
        group.push(synthesizer)
        groups.set(family, group)
    }
    return groups
}

function synthesisCommand(action: CodeAction | Command): Command | undefined {
    const command = typeof action.command === 'string' ? (action as Command) : action.command
    return command?.command === 'aeon.synthesize' ? command : undefined
}

/** Attach the time budget and prioritize the configured backend by its ID,
 * independently of the human-readable title sent by the server. */
export function configureSynthesisActions(
    actions: readonly (CodeAction | Command)[],
    preferred: string,
    budget: number,
): (CodeAction | Command)[] {
    const canonical = (id: string): string => (aliases as Record<string, string>)[id] ?? id
    const patched = actions.map(action => {
        const command = synthesisCommand(action)
        if (!command) return action
        const args = [...(command.arguments ?? [])]
        if (args.length === 3) args.push(budget)
        return typeof action.command === 'string'
            ? { ...action, arguments: args }
            : { ...action, command: { ...command, arguments: args } }
    })
    const rank = (action: CodeAction | Command): number => {
        const id: unknown = synthesisCommand(action)?.arguments?.[2]
        return typeof id === 'string' && canonical(id) === canonical(preferred) ? -1 : 0
    }
    return patched.sort((a, b) => rank(a) - rank(b))
}
