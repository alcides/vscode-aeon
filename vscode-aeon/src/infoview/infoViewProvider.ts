import * as vscode from 'vscode'
import { AeonClient } from '../aeonClient'
import {
    formatSynthesisBudget,
    synthesisBudgetSeconds,
    synthesisBudgetSlider,
    SYNTHESIS_BUDGET_MAX_S,
    SYNTHESIS_BUDGET_MIN_S,
} from '../config'

/** Wire format of the custom `aeon/infoView` LSP request (see
 * `aeon/lsp/infoview.py` in the compiler repository). Each context entry is a
 * base `type` plus an optional refinement `predicate` already rendered with the
 * binding's outer name (`v:{k:Int | k > 0}` arrives as type `Int`, predicate
 * `v > 0`). `target` is the turnstile goal: a hole's goal type, or the type of
 * the expression under the cursor. */
interface InfoEntry {
    name: string
    type: string
    predicate: string | null
}

/** One step of a failing VC's simplification chain (see
 * `aeon.verification.helpers.vc_simplification_steps`). Ordered original →
 * simplified; each `label` describes how its `text` was produced. */
interface VCStep {
    label: string
    text: string
}

/** A diagnostic for the error tab. Liquid type-checking failures carry a
 * `counterexample` and the `vcSteps` chain of the failing VC. */
interface ErrorInfo {
    message: string
    severity: string
    counterexample: string | null
    vcSteps: VCStep[]
    line: number | null
    endLine: number | null
    atCursor: boolean
}

/** A synthesis backend offered for the hole under the cursor. */
interface SynthesizerInfo {
    id: string
    label: string
    family: string
}

interface InfoViewResponse {
    target: { type: string; predicate: string | null } | null
    locals: InfoEntry[]
    globals: InfoEntry[]
    errors: ErrorInfo[]
    hole: string | null
    synthesizers: SynthesizerInfo[]
    aeonVersion?: string
}

/** Wire format of the `aeon/synthesisProgress` notification the server streams
 * while a hole is being synthesized (see `aeon/lsp/synthesis_ui.py`). */
interface SynthesisProgress {
    hole: string
    algorithm: string
    created: number
    assessed: number
    best: string | null
    bestQuality: string | null
    elapsed: number
    budget: number
    done: boolean
}

const INFOVIEW_REQUEST = 'aeon/infoView'
const SYNTHESIZE_COMMAND = 'aeon.synthesize'
const DEBOUNCE_MS = 150
/** Display order for synthesis families in the Synthesis tab. */
const SYNTH_FAMILY_ORDER = ['Enumerative', 'Random', 'Evolutionary', 'LLM'] as const
/** Keep a finished synthesis result visible this long before clearing it. */
const SYNTHESIS_CLEAR_MS = 12000

/**
 * A Lean-style info view: a webview panel beside the editor with three tabs for
 * the current cursor position:
 *   1. Error Messages — counterexamples and an interactive, expandable view of
 *      the failing VC's simplification chain.
 *   2. Context — the typing context (locals + goal + globals) laid out
 *      left-aligned with refinements aligned in a column.
 *   3. Synthesis — when the cursor is on a `?hole`, the available synthesis
 *      algorithms (click to run) and live progress of a running search.
 */
export class InfoViewProvider implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined
    private readonly disposables: vscode.Disposable[] = []
    private updateTimer: ReturnType<typeof setTimeout> | undefined
    private requestSeq = 0
    private synthesis: SynthesisProgress | undefined
    private synthesisClearTimer: ReturnType<typeof setTimeout> | undefined
    /** The document + hole the panel currently reflects, so a "run synthesis"
     * click from the webview can target the right file and hole. */
    private currentUri: string | undefined
    private currentHole: string | null = null
    private currentSynthesizers: SynthesizerInfo[] = []

    constructor(private readonly aeonClient: AeonClient) {
	vscode.window.onDidChangeTextEditorSelection(
	    e => this.scheduleUpdate(e.textEditor),
	    this,
	    this.disposables,
	)
	vscode.window.onDidChangeActiveTextEditor(
	    editor => {
		if (editor) this.scheduleUpdate(editor)
	    },
	    this,
	    this.disposables,
	)
	vscode.workspace.onDidChangeTextDocument(
	    e => {
		const editor = vscode.window.activeTextEditor
		if (editor && e.document === editor.document) this.scheduleUpdate(editor)
	    },
	    this,
	    this.disposables,
	)
    }

    isOpen(): boolean {
	return this.panel !== undefined
    }

    toggle(): void {
	if (this.panel) {
	    this.panel.dispose()
	} else {
	    this.open()
	}
    }

    open(): void {
	if (this.panel) {
	    this.panel.reveal(undefined, true)
	    return
	}
	this.panel = vscode.window.createWebviewPanel(
	    'aeonInfoView',
	    'Aeon Info View',
	    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
	    { enableScripts: true, retainContextWhenHidden: true },
	)
	this.panel.onDidDispose(() => {
	    this.panel = undefined
	})
	this.panel.webview.onDidReceiveMessage(
	    msg => this.onWebviewMessage(msg),
	    this,
	    this.disposables,
	)
	this.panel.webview.html = this.shellHtml()
	const editor = vscode.window.activeTextEditor
	if (editor) this.scheduleUpdate(editor)
    }

    /** Messages posted by the webview script — synthesis run buttons and the
     * budget slider. */
    private onWebviewMessage(msg: unknown): void {
	const m = msg as {
	    type?: string
	    synthesizer?: string
	    budgetSeconds?: number
	    position?: number
	} | null
	if (!m || typeof m.type !== 'string') return

	if (m.type === 'setBudgetSlider' && typeof m.position === 'number') {
	    const pos = Math.min(100, Math.max(0, Math.round(m.position)))
	    void vscode.workspace
		.getConfiguration('aeon')
		.update('synthesis.budgetSlider', pos, vscode.ConfigurationTarget.Global)
	    return
	}

	if (m.type !== 'synthesize' || typeof m.synthesizer !== 'string') return
	if (!this.currentUri || !this.currentHole) return

	const budget =
	    typeof m.budgetSeconds === 'number' && m.budgetSeconds > 0
		? m.budgetSeconds
		: synthesisBudgetSeconds()
	this.beginSynthesis(m.synthesizer, budget)
	void this.aeonClient.executeCommand(SYNTHESIZE_COMMAND, [
	    this.currentUri,
	    this.currentHole,
	    m.synthesizer,
	    budget,
	])
    }

    /** Optimistic progress shown the instant the user starts a synthesis run,
     * before the server has parsed the file and begun the search. */
    private beginSynthesis(synthesizerId: string, budgetSeconds: number): void {
	const label =
	    this.currentSynthesizers.find(s => s.id === synthesizerId)?.label ?? synthesizerId
	if (this.synthesisClearTimer) {
	    clearTimeout(this.synthesisClearTimer)
	    this.synthesisClearTimer = undefined
	}
	this.synthesis = {
	    hole: this.currentHole ?? '',
	    algorithm: label,
	    created: 0,
	    assessed: 0,
	    best: null,
	    bestQuality: null,
	    elapsed: 0,
	    budget: budgetSeconds,
	    done: false,
	}
	if (!this.panel) this.open()
	this.pushSynthesis()
    }

    private scheduleUpdate(editor: vscode.TextEditor): void {
	if (!this.panel) return
	if (editor.document.languageId !== 'aeon') return
	if (this.updateTimer) clearTimeout(this.updateTimer)
	this.updateTimer = setTimeout(() => void this.update(editor), DEBOUNCE_MS)
    }

    private async update(editor: vscode.TextEditor): Promise<void> {
	if (!this.panel) return
	const seq = ++this.requestSeq
	const document = editor.document
	const position = editor.selection.active

	let info: InfoViewResponse | null = null
	try {
	    info = await this.aeonClient.sendRequest<InfoViewResponse>(INFOVIEW_REQUEST, {
		textDocument: { uri: document.uri.toString() },
		position: { line: position.line, character: position.character },
	    })
	} catch {
	    // Server not running or request failed; show what we can.
	}
	// A newer cursor position superseded this request while it was in flight.
	if (seq !== this.requestSeq || !this.panel) return

	this.currentUri = document.uri.toString()
	this.currentHole = info?.hole ?? null
	this.currentSynthesizers = info?.synthesizers ?? []

	const fileName = document.uri.path.split('/').pop() ?? document.uri.path
	const location = `${esc(fileName)}:${position.line + 1}:${position.character + 1}`
	const aeonVersion = info?.aeonVersion?.trim()
	const locationLine =
	    aeonVersion && aeonVersion !== 'unknown'
		? `${location} · AeonLang ${esc(aeonVersion)}`
		: location
	const budgetSlider = synthesisBudgetSlider()

	// Prefer the server's structured errors; fall back to the diagnostics
	// VS Code already holds (e.g. syntax errors) for both content and badge.
	const serverErrorCount = info?.errors?.length ?? 0
	const errorCount = serverErrorCount > 0 ? serverErrorCount : diagnosticsAt(document, position).length

	void this.panel.webview.postMessage({
	    kind: 'update',
	    location: locationLine,
	    errors: this.renderErrors(document, position, info),
	    errorCount,
	    context: this.renderContext(info),
	    synthesis: this.renderSynthesis(info),
	    budgetSlider,
	    budgetLabel: formatSynthesisBudget(synthesisBudgetSeconds(budgetSlider)),
	})
    }

    /** Handle an `aeon/synthesisProgress` notification: update the live progress
     * region of the synthesis tab (independent of the cursor-driven content),
     * opening the panel and focusing the tab so progress is visible. */
    showSynthesisProgress(params: unknown): void {
	const p = params as Partial<SynthesisProgress> | null
	if (!p || typeof p.algorithm !== 'string') return
	this.synthesis = {
	    hole: typeof p.hole === 'string' ? p.hole : '',
	    algorithm: p.algorithm,
	    created: typeof p.created === 'number' ? p.created : 0,
	    assessed: typeof p.assessed === 'number' ? p.assessed : 0,
	    best: typeof p.best === 'string' ? p.best : null,
	    bestQuality: typeof p.bestQuality === 'string' ? p.bestQuality : null,
	    elapsed: typeof p.elapsed === 'number' ? p.elapsed : 0,
	    budget: typeof p.budget === 'number' ? p.budget : 0,
	    done: p.done === true,
	}
	if (!this.panel) {
	    // The webview script may not be ready to receive a message the very
	    // instant the panel is created; give it a beat before the first push.
	    this.open()
	    setTimeout(() => this.pushSynthesis(), DEBOUNCE_MS)
	    return
	}
	this.pushSynthesis()
    }

    private pushSynthesis(): void {
	if (this.synthesisClearTimer) {
	    clearTimeout(this.synthesisClearTimer)
	    this.synthesisClearTimer = undefined
	}
	const running = this.synthesis !== undefined && !this.synthesis.done
	const html = this.synthesis ? synthesisProgressHtml(this.synthesis) : ''
	void this.panel?.webview.postMessage({ kind: 'synthesisProgress', html, running, focus: true })
	// Once finished, keep the result up briefly, then clear it.
	if (this.synthesis?.done) {
	    this.synthesisClearTimer = setTimeout(() => {
		this.synthesis = undefined
		void this.panel?.webview.postMessage({
		    kind: 'synthesisProgress',
		    html: '',
		    running: false,
		    focus: false,
		})
	    }, SYNTHESIS_CLEAR_MS)
	}
    }

    // ------------------------------------------------------------- tab: errors

    private renderErrors(
	document: vscode.TextDocument,
	position: vscode.Position,
	info: InfoViewResponse | null,
    ): string {
	const errors = info?.errors ?? []
	if (errors.length > 0) {
	    return errors.map(errorHtml).join('')
	}
	// Fallback for errors the server does not surface structurally (e.g.
	// syntax errors): the diagnostics VS Code already holds at the cursor.
	const messages = diagnosticsAt(document, position)
	if (messages.length > 0) {
	    return messages.map(diagnosticHtml).join('')
	}
	return '<div class="empty">No errors at the cursor.</div>'
    }

    // ------------------------------------------------------------ tab: context

    private renderContext(info: InfoViewResponse | null): string {
	const parts: string[] = []
	const locals = info?.locals ?? []
	if (locals.length > 0) {
	    parts.push(section('Local Context', bindingTable(locals)))
	}
	if (info?.target) {
	    parts.push(section('Goal', turnstileHtml(info.target)))
	}
	const globals = info?.globals ?? []
	if (globals.length > 0) {
	    parts.push(
		`<details class="globals"><summary>Globals (${globals.length})</summary>` +
		    bindingTable(globals) +
		    '</details>',
	    )
	}
	if (parts.length === 0) {
	    parts.push('<div class="empty">No context available at the cursor.</div>')
	}
	return parts.join('\n')
    }

    // ---------------------------------------------------------- tab: synthesis

    private renderSynthesis(info: InfoViewResponse | null): string {
	const hole = info?.hole ?? null
	const synthesizers = info?.synthesizers ?? []
	const slider = synthesisBudgetSlider()
	const budgetLabel = formatSynthesisBudget(synthesisBudgetSeconds(slider))
	const sliderHtml =
	    `<div class="syn-budget">` +
	    `<label class="syn-budget-label">Time budget: <span id="budget-label">${esc(budgetLabel)}</span></label>` +
	    `<input type="range" class="syn-budget-slider" id="budget-slider" min="0" max="100" step="1" value="${slider}">` +
	    `<div class="syn-budget-hints"><span>${esc(formatSynthesisBudget(SYNTHESIS_BUDGET_MIN_S))}</span>` +
	    `<span>${esc(formatSynthesisBudget(SYNTHESIS_BUDGET_MAX_S))}</span></div></div>`

	if (!hole) {
	    return sliderHtml + '<div class="empty">Place the cursor on a <code>?hole</code> to synthesize it.</div>'
	}
	const header = `<div class="syn-header">Synthesize <span class="hole">?${esc(hole)}</span> with:</div>`
	const byFamily = new Map<string, SynthesizerInfo[]>()
	for (const s of synthesizers) {
	    const family = s.family || 'Random'
	    const bucket = byFamily.get(family) ?? []
	    bucket.push(s)
	    byFamily.set(family, bucket)
	}
	const knownFamilies = new Set<string>(SYNTH_FAMILY_ORDER)
	const orderedFamilies = [
	    ...SYNTH_FAMILY_ORDER.filter(f => byFamily.has(f)),
	    ...[...byFamily.keys()].filter(f => !knownFamilies.has(f)),
	]
	const groups = orderedFamilies
	    .map(family => {
		const items = (byFamily.get(family) ?? [])
		    .map(
			s =>
			    `<button class="syn-run" data-synth="${esc(s.id)}" title="${esc(s.id)}">` +
			    `<span class="syn-run-icon">▶</span> ${esc(s.label)}</button>`,
		    )
		    .join('')
		return `<div class="syn-family"><div class="syn-family-title">${esc(family)}</div><div class="syn-list">${items}</div></div>`
	    })
	    .join('')
	return `${sliderHtml}${header}<div class="syn-groups">${groups}</div>`
    }

    // ----------------------------------------------------------------- shell

    private shellHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
    body {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--vscode-editor-font-size, 13px);
	color: var(--vscode-editor-foreground);
	padding: 0;
	margin: 0;
    }
    .location {
	color: var(--vscode-descriptionForeground);
	font-size: 0.85em;
	padding: 0.4em 0.8em 0;
    }
    /* --- tab bar ---------------------------------------------------------- */
    .tabs {
	display: flex;
	gap: 0.2em;
	padding: 0.4em 0.6em 0;
	border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
	position: sticky;
	top: 0;
	background: var(--vscode-editor-background);
	z-index: 1;
    }
    .tab {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.85em;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	color: var(--vscode-descriptionForeground);
	padding: 0.4em 0.7em;
	cursor: pointer;
	white-space: nowrap;
    }
    .tab:hover { color: var(--vscode-editor-foreground); }
    .tab.active {
	color: var(--vscode-editor-foreground);
	border-bottom-color: var(--vscode-textLink-activeForeground, var(--vscode-focusBorder));
    }
    .tab .badge {
	display: inline-block;
	min-width: 1.4em;
	text-align: center;
	border-radius: 8px;
	padding: 0 0.35em;
	margin-left: 0.35em;
	font-size: 0.85em;
	background: var(--vscode-badge-background, rgba(128,128,128,0.3));
	color: var(--vscode-badge-foreground, inherit);
    }
    .tab .badge.err { background: var(--vscode-errorForeground, #f48771); color: #fff; }
    .tab .spin { margin-left: 0.35em; color: var(--vscode-textLink-foreground); }
    .tab .spin.hidden { display: none; }
    .panel { padding: 0.6em 0.8em; display: none; }
    .panel.active { display: block; }

    .section { margin-bottom: 1em; }
    .section-title {
	font-family: var(--vscode-font-family, sans-serif);
	font-weight: 600;
	font-size: 0.85em;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 0.3em;
	border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
	padding-bottom: 0.2em;
    }
    /* Context entries laid out as a left-aligned grid so that every column —
       including the refinement predicates after the bar — starts at the same x,
       aligning refinements together on the left. */
    .bindings {
	display: grid;
	grid-template-columns: max-content max-content max-content max-content minmax(0, 1fr);
	column-gap: 0.35em;
	row-gap: 0.15em;
	align-items: baseline;
	text-align: left;
    }
    .b-name { white-space: pre; }
    .b-colon { color: var(--vscode-descriptionForeground); }
    .b-type { white-space: pre; }
    .b-bar { color: var(--vscode-descriptionForeground); }
    .b-pred { overflow-wrap: anywhere; }
    .name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground)); }
    .type { color: var(--vscode-symbolIcon-typeParameterForeground, var(--vscode-textLink-foreground)); }
    .pred { color: var(--vscode-editor-foreground); }
    .conj { text-align: left; border-radius: 3px; padding: 0 0.3em; }
    .conj:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.18)); }
    .conj .op { color: var(--vscode-descriptionForeground); }
    .turnstile { margin: 0.15em 0; word-break: break-word; font-weight: 600; text-align: left; }
    .turnstile .turn { color: var(--vscode-symbolIcon-functionForeground, var(--vscode-textLink-activeForeground)); padding-right: 0.3em; }
    .turnstile .bar { color: var(--vscode-descriptionForeground); padding: 0 0.3em; font-weight: normal; }
    .turnstile .pred { font-weight: normal; display: inline-block; vertical-align: top; }
    details.globals summary {
	cursor: pointer;
	color: var(--vscode-descriptionForeground);
	font-size: 0.9em;
	margin-bottom: 0.3em;
    }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }

    /* --- errors ----------------------------------------------------------- */
    .error-item { margin-bottom: 1.2em; }
    .error-msg { white-space: pre-wrap; margin-bottom: 0.35em; }
    .error-item.error .error-msg { color: var(--vscode-errorForeground, #f48771); }
    .error-item.warning .error-msg { color: var(--vscode-editorWarning-foreground, #cca700); }
    .cex {
	margin: 0.25em 0 0.4em;
	padding: 0.25em 0.5em;
	border-left: 3px solid var(--vscode-errorForeground, #f48771);
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
	overflow-wrap: anywhere;
    }
    .cex .label {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	margin-right: 0.4em;
	text-transform: uppercase;
	letter-spacing: 0.03em;
    }
    .cex .value { color: var(--vscode-editor-foreground); font-weight: 600; }
    .vc-label {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	text-transform: uppercase;
	letter-spacing: 0.03em;
	margin: 0.3em 0 0.15em;
    }
    pre.vc {
	margin: 0;
	padding: 0.35em 0.5em;
	white-space: pre;
	overflow-x: auto;
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
	border-radius: 3px;
    }
    details.vc-step { margin-top: 0.25em; }
    details.vc-step > summary {
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.82em;
	margin: 0.25em 0;
	list-style: none;
    }
    details.vc-step > summary::before { content: '▸ '; }
    details.vc-step[open] > summary::before { content: '▾ '; }
    details.vc-step { border-left: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.4)); padding-left: 0.5em; }

    /* --- synthesis -------------------------------------------------------- */
    .syn-budget { margin-bottom: 0.9em; }
    .syn-budget-label {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.9em;
	color: var(--vscode-editor-foreground);
	display: block;
	margin-bottom: 0.35em;
    }
    .syn-budget-label #budget-label { font-weight: 600; }
    .syn-budget-slider {
	width: 100%;
	accent-color: var(--vscode-textLink-foreground);
	cursor: pointer;
    }
    .syn-budget-hints {
	display: flex;
	justify-content: space-between;
	font-size: 0.75em;
	color: var(--vscode-descriptionForeground);
	margin-top: 0.15em;
    }
    .syn-header { font-family: var(--vscode-font-family, sans-serif); margin-bottom: 0.5em; }
    .syn-header .hole { color: var(--vscode-symbolIcon-functionForeground, var(--vscode-textLink-foreground)); font-weight: 600; }
    .syn-groups { display: flex; flex-direction: column; gap: 0.75em; }
    .syn-family-title {
	font-family: var(--vscode-font-family, sans-serif);
	font-weight: 600;
	font-size: 0.8em;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 0.25em;
    }
    .syn-list { display: flex; flex-direction: column; gap: 0.25em; }
    .syn-run {
	text-align: left;
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.9em;
	background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
	color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
	border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
	border-radius: 4px;
	padding: 0.35em 0.6em;
	cursor: pointer;
    }
    .syn-run:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.28)); }
    .syn-run-icon { color: var(--vscode-textLink-foreground); margin-right: 0.35em; }
    .synthesis { margin-bottom: 1em; }
    .syn-progress { margin-bottom: 1em; }
    .syn-algo { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-editor-foreground); margin-bottom: 0.25em; }
    .syn-algo .done { color: var(--vscode-testing-iconPassed, #4caf50); }
    .syn-algo .spin { color: var(--vscode-descriptionForeground); }
    .syn-algo .syn-starting {
	font-weight: normal;
	color: var(--vscode-descriptionForeground);
	font-size: 0.9em;
    }
    .syn-stats { font-family: var(--vscode-font-family, sans-serif); font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-bottom: 0.35em; }
    .syn-stats .num { color: var(--vscode-editor-foreground); font-weight: 600; }
    .syn-best {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
	border-radius: 3px;
	padding: 0.2em 0.4em;
	margin-bottom: 0.4em;
    }
    .syn-best .label { font-family: var(--vscode-font-family, sans-serif); font-size: 0.8em; color: var(--vscode-descriptionForeground); display: block; }
    .syn-bar { height: 6px; border-radius: 3px; background: rgba(128,128,128,0.25); overflow: hidden; }
    .syn-bar-fill { height: 100%; background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground)); transition: width 0.2s ease; }
    .syn-time { font-size: 0.8em; color: var(--vscode-descriptionForeground); text-align: right; margin-top: 0.15em; }
</style>
</head>
<body>
<div class="tabs">
    <button class="tab active" data-tab="errors">Errors<span class="badge" id="badge-errors" style="display:none"></span></button>
    <button class="tab" data-tab="context">Context</button>
    <button class="tab" data-tab="synthesis">Synthesis<span class="spin hidden" id="spin-synthesis">⟳</span></button>
</div>
<div class="location" id="location"></div>
<div class="panel active" id="panel-errors"><div class="empty">Place the cursor in an Aeon file.</div></div>
<div class="panel" id="panel-context"><div class="empty">Place the cursor in an Aeon file.</div></div>
<div class="panel" id="panel-synthesis">
    <div class="syn-progress" id="synthesis-progress"></div>
    <div id="synthesis-list"><div class="empty">Place the cursor on a <code>?hole</code> to synthesize it.</div></div>
</div>
<script>
    const vscode = acquireVsCodeApi();

    const BUDGET_MIN = ${SYNTHESIS_BUDGET_MIN_S};
    const BUDGET_MAX = ${SYNTHESIS_BUDGET_MAX_S};

    function sliderToSeconds(pos) {
	const t = pos / 100;
	return BUDGET_MIN * Math.pow(BUDGET_MAX / BUDGET_MIN, t);
    }

    function formatBudget(seconds) {
	const s = Math.round(seconds);
	if (s < 60) return s + 's';
	if (s < 3600) {
	    const m = Math.floor(s / 60);
	    const rem = s % 60;
	    return rem > 0 ? m + 'm ' + rem + 's' : m + 'm';
	}
	const h = Math.floor(s / 3600);
	const m = Math.round((s % 3600) / 60);
	return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
    }

    function updateBudgetLabel(pos) {
	const label = document.getElementById('budget-label');
	if (label) label.textContent = formatBudget(sliderToSeconds(pos));
    }

    function activate(tab) {
	document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
	document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
    }

    document.querySelectorAll('.tab').forEach(t => {
	t.addEventListener('click', () => activate(t.dataset.tab));
    });

    // Delegate clicks on synthesis "run" buttons to the extension.
    document.getElementById('panel-synthesis').addEventListener('click', event => {
	const btn = event.target.closest('.syn-run');
	if (!btn) return;
	const slider = document.getElementById('budget-slider');
	const pos = slider ? Number(slider.value) : 0;
	vscode.postMessage({
	    type: 'synthesize',
	    synthesizer: btn.dataset.synth,
	    budgetSeconds: sliderToSeconds(pos),
	});
    });

    document.getElementById('panel-synthesis').addEventListener('input', event => {
	const slider = event.target.closest('#budget-slider');
	if (!slider) return;
	const pos = Number(slider.value);
	updateBudgetLabel(pos);
	vscode.postMessage({ type: 'setBudgetSlider', position: pos });
    });

    function setBadge(count) {
	const b = document.getElementById('badge-errors');
	if (count > 0) { b.textContent = String(count); b.classList.add('err'); b.style.display = ''; }
	else { b.style.display = 'none'; }
    }

    window.addEventListener('message', event => {
	const data = event.data;
	if (!data) return;
	if (data.kind === 'update') {
	    document.getElementById('location').textContent = data.location || '';
	    document.getElementById('panel-errors').innerHTML = data.errors;
	    document.getElementById('panel-context').innerHTML = data.context;
	    document.getElementById('synthesis-list').innerHTML = data.synthesis;
	    setBadge(data.errorCount || 0);
	    const slider = document.getElementById('budget-slider');
	    if (slider && typeof data.budgetSlider === 'number') {
		slider.value = String(data.budgetSlider);
		updateBudgetLabel(data.budgetSlider);
	    } else if (typeof data.budgetLabel === 'string') {
		const label = document.getElementById('budget-label');
		if (label) label.textContent = data.budgetLabel;
	    }
	} else if (data.kind === 'synthesisProgress') {
	    document.getElementById('synthesis-progress').innerHTML = data.html || '';
	    document.getElementById('spin-synthesis').classList.toggle('hidden', !data.running);
	    if (data.focus) activate('synthesis');
	}
    });
</script>
</body>
</html>`
    }

    dispose(): void {
	if (this.updateTimer) clearTimeout(this.updateTimer)
	if (this.synthesisClearTimer) clearTimeout(this.synthesisClearTimer)
	this.panel?.dispose()
	for (const d of this.disposables) d.dispose()
    }
}

// --------------------------------------------------------------- helpers

function esc(text: string): string {
    return text
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
}

function section(title: string, body: string): string {
    return `<div class="section"><div class="section-title">${esc(title)}</div>${body}</div>`
}

/** Split a pretty-printed predicate into its top-level `&&` conjuncts. The
 * server's printer parenthesises lower-precedence sub-terms and wraps call
 * arguments, so a ` && ` at bracket/quote depth 0 is always a real top-level
 * conjunct — anything nested stays inside its brackets. */
function splitConjuncts(predicate: string): string[] {
    const parts: string[] = []
    let buf = ''
    let depth = 0
    let inStr = false
    for (let i = 0; i < predicate.length; i++) {
        const ch = predicate[i]
        if (ch === '"') inStr = !inStr
        if (!inStr) {
            if (ch === '(' || ch === '[' || ch === '{') depth++
            else if (ch === ')' || ch === ']' || ch === '}') depth--
            else if (
                depth === 0 &&
                ch === '&' &&
                predicate[i + 1] === '&' &&
                predicate[i - 1] === ' ' &&
                predicate[i + 2] === ' '
            ) {
                parts.push(buf.trim())
                buf = ''
                i += 2
                continue
            }
        }
        buf += ch
    }
    if (buf.trim()) parts.push(buf.trim())
    return parts.length > 0 ? parts : [predicate]
}

/** Render a predicate as one conjunct per line, each but the last ending in
 * `&&`. Each line is hover-highlightable (see the `.conj` CSS). */
function predicateHtml(predicate: string): string {
    const conjuncts = splitConjuncts(predicate)
    return conjuncts
	.map((c, i) => {
	    const amp = i < conjuncts.length - 1 ? ' <span class="op">&amp;&amp;</span>' : ''
	    return `<div class="conj">${esc(c)}${amp}</div>`
	})
	.join('')
}

/** A left-aligned grid of `name : type | predicate` rows. Grid columns keep the
 * bars and the refinement predicates aligned in a column on the left; entries
 * without a refinement leave the bar/predicate cells empty. */
function bindingTable(entries: InfoEntry[]): string {
    const rows = entries
	.map(e => {
	    const lhs =
		`<div class="b-name"><span class="name">${esc(e.name)}</span></div>` +
		`<div class="b-colon">:</div>` +
		`<div class="b-type"><span class="type">${esc(e.type)}</span></div>`
	    if (e.predicate) {
		return lhs + `<div class="b-bar">|</div><div class="b-pred">${predicateHtml(e.predicate)}</div>`
	    }
	    return lhs + `<div class="b-bar"></div><div class="b-pred"></div>`
	})
	.join('')
    return `<div class="bindings">${rows}</div>`
}

/** The goal shown Lean-style: `⊢ Type` (with ` | predicate` when refined). */
function turnstileHtml(target: { type: string; predicate: string | null }): string {
    const pred = target.predicate
	? ` <span class="bar">|</span> <span class="pred">${predicateHtml(target.predicate)}</span>`
	: ''
    return `<div class="turnstile"><span class="turn">⊢</span><span class="type">${esc(target.type)}</span>${pred}</div>`
}

/** An interactive view of a failing VC: the fully simplified form up front, and
 * a nested chain of `<details>` that each reveal the VC as it was *before* the
 * corresponding simplification step, back to the original. */
function vcStepsHtml(steps: VCStep[]): string {
    if (steps.length === 0) return ''
    const final = steps[steps.length - 1]
    const finalLabel = steps.length > 1 ? 'Simplified verification condition' : esc(final.label)
    let html =
	`<div class="vc-label">${finalLabel}</div>` +
	`<pre class="vc">${esc(final.text)}</pre>`

    // Build the nested "before <step>" disclosures from the outermost (the last
    // simplification) inward to the original.
    let inner = ''
    for (let i = 1; i < steps.length; i++) {
	const prev = steps[i - 1]
	inner =
	    `<details class="vc-step"><summary>before: ${esc(steps[i].label)}</summary>` +
	    `<pre class="vc">${esc(prev.text)}</pre>${inner}</details>`
    }
    return html + inner
}

function errorHtml(e: ErrorInfo): string {
    const cls = e.severity === 'warning' ? 'warning' : 'error'
    const parts: string[] = [`<div class="error-msg">${esc(e.message)}</div>`]
    if (e.counterexample) {
	parts.push(
	    `<div class="cex"><span class="label">Counterexample</span>` +
		`<span class="value">${esc(e.counterexample)}</span></div>`,
	)
    }
    if (e.vcSteps && e.vcSteps.length > 0) {
	parts.push(vcStepsHtml(e.vcSteps))
    }
    return `<div class="error-item ${cls}">${parts.join('')}</div>`
}

/** Render the live synthesis progress region: algorithm, candidate counts,
 * best candidate so far, and a time progress bar (full on completion). */
function synthesisProgressHtml(s: SynthesisProgress): string {
    const holeLabel = s.hole ? ` <span class="b-bar">·</span> ?${esc(s.hole)}` : ''
    const status = s.done ? '<span class="done">✓</span>' : '<span class="spin">⟳</span>'
    const starting = !s.done && s.created === 0 && s.assessed === 0 && s.elapsed === 0
    const algo =
	`<div class="syn-algo">${status} ${esc(s.algorithm)}${holeLabel}` +
	(starting ? ' <span class="syn-starting">starting…</span>' : '') +
	`</div>`

    const stats =
	`<div class="syn-stats">` +
	`<span class="num">${s.created}</span> created` +
	` <span class="b-bar">·</span> ` +
	`<span class="num">${s.assessed}</span> assessed</div>`

    let best = ''
    if (s.best) {
	const q = s.bestQuality ? ` <span class="label">quality ${esc(s.bestQuality)}</span>` : ''
	best =
	    `<div class="syn-best"><span class="label">best${s.done ? '' : ' so far'}</span>` +
	    `${esc(s.best)}${q}</div>`
    }

    const pct =
	s.budget > 0 ? Math.min(100, Math.round((100 * s.elapsed) / s.budget)) : s.done ? 100 : 0
    const bar = `<div class="syn-bar"><div class="syn-bar-fill" style="width:${pct}%"></div></div>`
    const time =
	s.budget > 0
	    ? `<div class="syn-time">${s.elapsed.toFixed(1)}s / ${s.budget.toFixed(0)}s</div>`
	    : ''

    return section('Running', `<div class="synthesis">${algo}${stats}${best}${bar}${time}</div>`)
}

function diagnosticsAt(document: vscode.TextDocument, position: vscode.Position): vscode.Diagnostic[] {
    return vscode.languages
	.getDiagnostics(document.uri)
	.filter(d => d.range.start.line <= position.line && position.line <= d.range.end.line)
}

function diagnosticHtml(d: vscode.Diagnostic): string {
    const cls = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
    return `<div class="error-item ${cls}"><div class="error-msg">${esc(d.message)}</div></div>`
}
