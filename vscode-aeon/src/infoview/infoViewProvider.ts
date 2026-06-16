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

const INFOVIEW_REQUEST = 'aeon/infoView'
const DEBOUNCE_MS = 150

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
       part before the bar is right-aligned, the predicate after it likewise. */
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
    .conj { text-align: right; border-radius: 3px; padding: 0 0.3em; }
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
</style>
</head>
<body>
<div id="content"><div class="empty">Place the cursor in an Aeon file.</div></div>
<script>
    window.addEventListener('message', event => {
	if (event.data && event.data.kind === 'update') {
	    document.getElementById('content').innerHTML = event.data.html;
	}
    });
</script>
</body>
</html>`
    }

    dispose(): void {
	if (this.updateTimer) clearTimeout(this.updateTimer)
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

function diagnosticsAt(document: vscode.TextDocument, position: vscode.Position): vscode.Diagnostic[] {
    return vscode.languages
	.getDiagnostics(document.uri)
	.filter(d => d.range.start.line <= position.line && position.line <= d.range.end.line)
}

function diagnosticHtml(d: vscode.Diagnostic): string {
    const cls = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
    return `<div class="diagnostic ${cls}">${esc(d.message)}</div>`
}
