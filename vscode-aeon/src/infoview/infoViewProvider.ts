import * as vscode from 'vscode'
import { AeonClient } from '../aeonClient'

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

interface InfoViewResponse {
    target: { type: string; predicate: string | null } | null
    locals: InfoEntry[]
    globals: InfoEntry[]
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
const DEBOUNCE_MS = 150
/** Keep a finished synthesis result visible this long before clearing it. */
const SYNTHESIS_CLEAR_MS = 12000

/**
 * A Lean-style info view: a webview panel beside the editor showing, for the
 * current cursor position, the goal of the hole under the cursor, the type of
 * the expression under the cursor, the typing context (locals prominently,
 * globals collapsed) and the diagnostics at the cursor.
 */
export class InfoViewProvider implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined
    private readonly disposables: vscode.Disposable[] = []
    private updateTimer: ReturnType<typeof setTimeout> | undefined
    private requestSeq = 0
    private synthesis: SynthesisProgress | undefined
    private synthesisClearTimer: ReturnType<typeof setTimeout> | undefined

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
	this.panel.webview.html = this.shellHtml()
	const editor = vscode.window.activeTextEditor
	if (editor) this.scheduleUpdate(editor)
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

	const html = this.render(document, position, info)
	void this.panel.webview.postMessage({ kind: 'update', html })
    }

    /** Handle an `aeon/synthesisProgress` notification: update the dedicated
     * synthesis region of the info view (independent of the cursor-driven
     * content), opening the panel if needed so progress is visible. */
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
	const html = this.synthesis ? synthesisHtml(this.synthesis) : ''
	void this.panel?.webview.postMessage({ kind: 'synthesis', html })
	// Once finished, keep the result up briefly, then clear it.
	if (this.synthesis?.done) {
	    this.synthesisClearTimer = setTimeout(() => {
		this.synthesis = undefined
		void this.panel?.webview.postMessage({ kind: 'synthesis', html: '' })
	    }, SYNTHESIS_CLEAR_MS)
	}
    }

    // ----------------------------------------------------------------- HTML

    private render(
	document: vscode.TextDocument,
	position: vscode.Position,
	info: InfoViewResponse | null,
    ): string {
	const fileName = document.uri.path.split('/').pop() ?? document.uri.path
	const parts: string[] = []
	parts.push(
	    `<div class="location">${esc(fileName)}:${position.line + 1}:${position.character + 1}</div>`,
	)

	// Lean-style order: the local context first, then the goal turnstile.
	const locals = info?.locals ?? []
	if (locals.length > 0) {
	    parts.push(section('Context', bindingTable(locals)))
	}

	if (info?.target) {
	    parts.push(section('Goal', turnstileHtml(info.target)))
	}

	const messages = diagnosticsAt(document, position)
	if (messages.length > 0) {
	    parts.push(section('Messages', messages.map(diagnosticHtml).join('')))
	}

	const globals = info?.globals ?? []
	if (globals.length > 0) {
	    parts.push(
		`<details class="globals"><summary>Globals (${globals.length})</summary>` +
		    bindingTable(globals) +
		    '</details>',
	    )
	}

	if (!info || (!info.target && locals.length === 0 && messages.length === 0)) {
	    parts.push('<div class="empty">No information available at the cursor.</div>')
	}
	return parts.join('\n')
    }

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
	padding: 0.5em 0.8em;
    }
    .location {
	color: var(--vscode-descriptionForeground);
	font-size: 0.85em;
	margin-bottom: 0.6em;
    }
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
    /* Context entries laid out as a grid so the bar separators line up; the
       part before the bar is right-aligned, the refinement after it left-aligned. */
    .bindings {
	display: grid;
	grid-template-columns: max-content max-content minmax(0, max-content);
	row-gap: 0.15em;
	align-items: baseline;
    }
    .b-lhs { text-align: right; white-space: pre; }
    .b-bar { color: var(--vscode-descriptionForeground); padding: 0 0.5em; }
    .b-pred { overflow-wrap: anywhere; }
    .name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground)); }
    .colon { color: var(--vscode-descriptionForeground); }
    .type { color: var(--vscode-symbolIcon-typeParameterForeground, var(--vscode-textLink-foreground)); }
    .pred { color: var(--vscode-editor-foreground); }
    /* One conjunct per line (with a trailing && on all but the last); each
       line takes a subtle, theme-aware highlight on hover. */
    .conj { text-align: left; border-radius: 3px; padding: 0 0.3em; }
    .conj:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.18)); }
    .conj .op { color: var(--vscode-descriptionForeground); }
    .turnstile { margin: 0.15em 0; word-break: break-word; font-weight: 600; }
    .turnstile .turn { color: var(--vscode-symbolIcon-functionForeground, var(--vscode-textLink-activeForeground)); padding-right: 0.3em; }
    .turnstile .bar { color: var(--vscode-descriptionForeground); padding: 0 0.3em; font-weight: normal; }
    .turnstile .pred { font-weight: normal; display: inline-block; vertical-align: top; }
    .diagnostic { margin: 0.15em 0; white-space: pre-wrap; }
    .diagnostic.error { color: var(--vscode-errorForeground, #f48771); }
    .diagnostic.warning { color: var(--vscode-editorWarning-foreground, #cca700); }
    details.globals summary {
	cursor: pointer;
	color: var(--vscode-descriptionForeground);
	font-size: 0.9em;
	margin-bottom: 0.3em;
    }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    /* Live synthesis progress (separate, server-pushed region). */
    .synthesis { margin-bottom: 1em; }
    .syn-algo {
	font-family: var(--vscode-font-family, sans-serif);
	color: var(--vscode-editor-foreground);
	margin-bottom: 0.25em;
    }
    .syn-algo .done { color: var(--vscode-testing-iconPassed, #4caf50); }
    .syn-algo .spin { color: var(--vscode-descriptionForeground); }
    .syn-stats {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.9em;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 0.35em;
    }
    .syn-stats .num { color: var(--vscode-editor-foreground); font-weight: 600; }
    .syn-best {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
	border-radius: 3px;
	padding: 0.2em 0.4em;
	margin-bottom: 0.4em;
    }
    .syn-best .label {
	font-family: var(--vscode-font-family, sans-serif);
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	display: block;
    }
    .syn-bar {
	height: 6px;
	border-radius: 3px;
	background: rgba(128,128,128,0.25);
	overflow: hidden;
    }
    .syn-bar-fill {
	height: 100%;
	background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
	transition: width 0.2s ease;
    }
    .syn-time {
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	text-align: right;
	margin-top: 0.15em;
    }
</style>
</head>
<body>
<div id="synthesis"></div>
<div id="content"><div class="empty">Place the cursor in an Aeon file.</div></div>
<script>
    window.addEventListener('message', event => {
	const data = event.data;
	if (!data) return;
	if (data.kind === 'update') {
	    document.getElementById('content').innerHTML = data.html;
	} else if (data.kind === 'synthesis') {
	    document.getElementById('synthesis').innerHTML = data.html;
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

/** A grid of `name : type | predicate` rows. The grid columns make every `|`
 * line up; entries without a refinement leave the bar/predicate cells empty. */
function bindingTable(entries: InfoEntry[]): string {
    const rows = entries
	.map(e => {
	    const lhs =
		`<div class="b-lhs"><span class="name">${esc(e.name)}</span>` +
		`<span class="colon"> : </span><span class="type">${esc(e.type)}</span></div>`
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

/** Render the live synthesis progress region: algorithm, candidate counts,
 * best candidate so far, and a time progress bar (full on completion). */
function synthesisHtml(s: SynthesisProgress): string {
    const holeLabel = s.hole ? ` <span class="b-bar">·</span> ${esc(s.hole)}` : ''
    const status = s.done
	? '<span class="done">✓</span>'
	: '<span class="spin">⟳</span>'
    const algo = `<div class="syn-algo">${status} ${esc(s.algorithm)}${holeLabel}</div>`

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

    return section('Synthesis', `<div class="synthesis">${algo}${stats}${best}${bar}${time}</div>`)
}

function diagnosticsAt(document: vscode.TextDocument, position: vscode.Position): vscode.Diagnostic[] {
    return vscode.languages
	.getDiagnostics(document.uri)
	.filter(d => d.range.start.line <= position.line && position.line <= d.range.end.line)
}

function diagnosticHtml(d: vscode.Diagnostic): string {
    const cls = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
    return `<div class="diagnostic ${cls}">${esc(d.message)}</div>`
}
