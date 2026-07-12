import * as vscode from 'vscode'
import { workspace } from 'vscode'

export function localPackagePath(): string {
    const p: string | undefined = vscode.workspace.getConfiguration('aeon').get('localPackagePath')
    return p?.trim() ?? ''
}

export function defaultSynthesizer(): string {
    const s: string | undefined = vscode.workspace.getConfiguration('aeon').get('defaultSynthesizer')
    return s?.trim() || 'gp'
}

/** Shortest synthesis budget (seconds) when the slider is at 0. */
export const SYNTHESIS_BUDGET_MIN_S = 5
/** Longest synthesis budget (seconds) when the slider is at 100 (30 minutes). */
export const SYNTHESIS_BUDGET_MAX_S = 30 * 60

/** The 0–100 synthesis budget slider position from settings. */
export function synthesisBudgetSlider(): number {
    const v = workspace.getConfiguration('aeon').get<number>('synthesis.budgetSlider')
    if (typeof v !== 'number' || Number.isNaN(v)) return 0
    return Math.min(100, Math.max(0, Math.round(v)))
}

/** Map a slider position (0–100) to a budget in seconds, exponentially between
 * ``SYNTHESIS_BUDGET_MIN_S`` and ``SYNTHESIS_BUDGET_MAX_S``. */
export function synthesisBudgetSeconds(slider?: number): number {
    const pos = slider ?? synthesisBudgetSlider()
    const t = pos / 100
    return SYNTHESIS_BUDGET_MIN_S * Math.pow(SYNTHESIS_BUDGET_MAX_S / SYNTHESIS_BUDGET_MIN_S, t)
}

/** Human-readable synthesis budget, e.g. ``5s``, ``1m 30s``, ``30m``. */
export function formatSynthesisBudget(seconds: number): string {
    const s = Math.round(seconds)
    if (s < 60) return `${s}s`
    if (s < 3600) {
        const m = Math.floor(s / 60)
        const rem = s % 60
        return rem > 0 ? `${m}m ${rem}s` : `${m}m`
    }
    const h = Math.floor(s / 3600)
    const m = Math.round((s % 3600) / 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * Build the command + args used to invoke the `aeon` program (via `uvx`),
 * honouring the `aeon.localPackagePath` setting. `extraArgs` are appended after
 * the `aeon` subcommand, e.g. `['--language-server-mode']` or `['--format', file]`.
 */
export function aeonExecutable(extraArgs: string[]): { command: string; args: string[] } {
    const pkgPath = localPackagePath()
    if (pkgPath) {
        return { command: 'uvx', args: ['--from', pkgPath, 'aeon', ...extraArgs] }
    }
    return { command: 'uvx', args: ['--refresh', '--from', 'aeonlang', 'aeon', ...extraArgs] }
}

/** Shell-escaped ``uvx … aeon …`` command for terminal probes (``-h``, etc.). */
export function aeonShellCommand(extraArgs: string[]): string {
    const { command, args } = aeonExecutable(extraArgs)
    const quote = (arg: string) => (/^[A-Za-z0-9_./:=+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`)
    return [command, ...args.map(quote)].join(' ')
}
