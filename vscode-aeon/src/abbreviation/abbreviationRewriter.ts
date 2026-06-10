import {
    Disposable,
    Range,
    TextDocument,
    TextEditor,
    TextEditorDecorationType,
    ThemeColor,
    window,
    workspace,
} from 'vscode'
import { AbbreviationConfig } from './abbreviationConfig'
import { AbbreviationProvider } from './abbreviationProvider'

interface Tracker {
    /** Offset of the leader character in the document. */
    leaderOffset: number
    /** Characters typed after the leader (without the leader itself). */
    match: string
}

/**
 * Rewrites Lean-style abbreviations as the user types: `\to` becomes `→`, `\alpha`
 * becomes `α`, and so on. A single abbreviation is tracked at a time (the most recent
 * leader). It is replaced when
 *   - it becomes unambiguous and eager replacement is on, or
 *   - a character that cannot continue any abbreviation is typed, or
 *   - the cursor moves out of the tracked region.
 */
export class AbbreviationRewriter implements Disposable {
    private readonly disposables: Disposable[] = []
    private readonly decorationType: TextEditorDecorationType
    private tracker: Tracker | undefined
    private trackedDocument: TextDocument | undefined
    /** Guards against reacting to our own edits. */
    private applying = false

    constructor(
        private readonly languageId: string,
        private readonly config: AbbreviationConfig,
        private readonly provider: AbbreviationProvider,
    ) {
        this.decorationType = window.createTextEditorDecorationType({
            textDecoration: 'underline',
            color: new ThemeColor('editorLink.activeForeground'),
        })
        this.disposables.push(
            this.decorationType,
            workspace.onDidChangeTextDocument(e => {
                if (this.applying) {
                    return
                }
                const editor = window.activeTextEditor
                if (!editor || editor.document !== e.document) {
                    if (this.tracker && e.document === this.trackedDocument) {
                        this.reset()
                    }
                    return
                }
                void this.onDocumentChange(editor, e.contentChanges)
            }),
            window.onDidChangeTextEditorSelection(e => {
                if (this.applying || !this.tracker) {
                    return
                }
                if (e.textEditor.document !== this.trackedDocument) {
                    this.reset()
                    return
                }
                void this.onSelectionChange(e.textEditor)
            }),
            window.onDidChangeActiveTextEditor(() => this.reset()),
        )
    }

    /** Convert the currently tracked abbreviation, if any. Used by the convert command. */
    async convert(): Promise<void> {
        const editor = window.activeTextEditor
        if (this.tracker && editor && editor.document === this.trackedDocument) {
            await this.finalize(editor)
        }
    }

    private async onDocumentChange(
        editor: TextEditor,
        changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
    ): Promise<void> {
        if (editor.document.languageId !== this.languageId) {
            return
        }
        // Only single, simple edits (ordinary typing) are handled; anything else
        // (paste, multi-cursor, completion accept) drops the tracker.
        if (changes.length !== 1) {
            this.reset()
            return
        }
        const change = changes[0]
        if (change.text === '' && change.rangeLength > 0) {
            this.handleDeletion(editor, change.rangeOffset, change.rangeLength)
            return
        }
        if (change.rangeLength !== 0 || change.text.length !== 1) {
            this.reset()
            return
        }
        await this.handleInsert(editor, change.text, change.rangeOffset)
    }

    private async handleInsert(editor: TextEditor, c: string, offset: number): Promise<void> {
        const leader = this.config.leader

        if (this.tracker) {
            const expected = this.tracker.leaderOffset + 1 + this.tracker.match.length
            if (offset === expected) {
                const next = this.tracker.match + c
                if (this.provider.isPrefix(next)) {
                    this.tracker.match = next
                    this.updateDecoration(editor)
                    if (this.config.eager && this.provider.isExact(next) && !this.provider.hasLongerExtension(next)) {
                        await this.replace(editor, this.tracker.leaderOffset, next)
                        this.reset()
                    }
                    return
                }
                // `next` cannot continue any abbreviation.
                if (c === leader) {
                    await this.retrigger(editor, offset)
                    return
                }
                // A breaking character: commit an exact match (the breaking char stays put).
                if (this.provider.isExact(this.tracker.match)) {
                    await this.replace(editor, this.tracker.leaderOffset, this.tracker.match)
                }
                this.reset()
                return
            }
            // Insertion somewhere else: abandon the current abbreviation untouched.
            this.reset()
        }

        if (c === leader) {
            this.startTracker(editor, offset)
        }
    }

    /** The leader was typed right after a (non-extendable) match: commit it and restart. */
    private async retrigger(editor: TextEditor, leaderInsertOffset: number): Promise<void> {
        const current = this.tracker!
        let newLeaderOffset = leaderInsertOffset
        if (this.provider.isExact(current.match)) {
            const symbol = this.provider.getSymbol(current.match)!
            await this.replace(editor, current.leaderOffset, current.match)
            // The just-typed leader shifted left to sit right after the inserted symbol.
            newLeaderOffset = current.leaderOffset + symbol.length
        }
        this.reset()
        this.startTracker(editor, newLeaderOffset)
    }

    private handleDeletion(editor: TextEditor, delOffset: number, delLength: number): void {
        if (!this.tracker) {
            return
        }
        const matchStart = this.tracker.leaderOffset + 1
        const matchEnd = matchStart + this.tracker.match.length
        if (delOffset <= this.tracker.leaderOffset) {
            // The leader (or text before it) was removed.
            this.reset()
            return
        }
        if (delOffset >= matchStart && delOffset + delLength <= matchEnd) {
            this.tracker.match = this.tracker.match.slice(0, this.tracker.match.length - delLength)
            this.updateDecoration(editor)
            return
        }
        this.reset()
    }

    private async onSelectionChange(editor: TextEditor): Promise<void> {
        if (!this.tracker) {
            return
        }
        const cursor = editor.document.offsetAt(editor.selection.active)
        const start = this.tracker.leaderOffset
        const end = this.tracker.leaderOffset + 1 + this.tracker.match.length
        if (cursor < start || cursor > end) {
            await this.finalize(editor)
        }
    }

    /** Commit an exact match if there is one, then stop tracking. */
    private async finalize(editor: TextEditor): Promise<void> {
        const current = this.tracker
        if (current && this.provider.isExact(current.match)) {
            await this.replace(editor, current.leaderOffset, current.match)
        }
        this.reset()
    }

    private async replace(editor: TextEditor, leaderOffset: number, match: string): Promise<void> {
        const symbol = this.provider.getSymbol(match)
        if (symbol === undefined) {
            return
        }
        const doc = editor.document
        const range = new Range(doc.positionAt(leaderOffset), doc.positionAt(leaderOffset + 1 + match.length))
        this.applying = true
        try {
            await editor.edit(b => b.replace(range, symbol), { undoStopBefore: false, undoStopAfter: false })
        } finally {
            this.applying = false
        }
    }

    private startTracker(editor: TextEditor, leaderOffset: number): void {
        this.tracker = { leaderOffset, match: '' }
        this.trackedDocument = editor.document
        this.updateDecoration(editor)
    }

    private updateDecoration(editor: TextEditor): void {
        if (!this.tracker) {
            editor.setDecorations(this.decorationType, [])
            return
        }
        const doc = editor.document
        const range = new Range(
            doc.positionAt(this.tracker.leaderOffset),
            doc.positionAt(this.tracker.leaderOffset + 1 + this.tracker.match.length),
        )
        editor.setDecorations(this.decorationType, [range])
    }

    private reset(): void {
        this.tracker = undefined
        this.trackedDocument = undefined
        for (const editor of window.visibleTextEditors) {
            editor.setDecorations(this.decorationType, [])
        }
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
