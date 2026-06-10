import {
    commands,
    CompletionItem,
    CompletionItemKind,
    CompletionItemProvider,
    CompletionList,
    Disposable,
    ExtensionContext,
    languages,
    Position,
    Range,
    TextDocument,
    workspace,
} from 'vscode'
import { AbbreviationConfig, getAbbreviationConfig } from './abbreviationConfig'
import { AbbreviationProvider } from './abbreviationProvider'
import { AbbreviationRewriter } from './abbreviationRewriter'

const LANGUAGE_ID = 'aeon'

/**
 * Offers every abbreviation that matches what has been typed after a leader as a
 * completion item, so users can discover symbols and accept them from the dropdown.
 */
class AbbreviationCompletionProvider implements CompletionItemProvider {
    constructor(
        private readonly config: AbbreviationConfig,
        private readonly provider: AbbreviationProvider,
    ) {}

    provideCompletionItems(document: TextDocument, position: Position): CompletionList | undefined {
        const leader = this.config.leader
        const linePrefix = document.lineAt(position.line).text.substring(0, position.character)
        const leaderIndex = linePrefix.lastIndexOf(leader)
        if (leaderIndex === -1) {
            return undefined
        }
        const typed = linePrefix.substring(leaderIndex + 1)
        if (/\s/.test(typed)) {
            return undefined
        }
        const keys = this.provider.matchingKeys(typed)
        if (keys.length === 0) {
            return undefined
        }
        const replaceRange = new Range(position.line, leaderIndex, position.line, position.character)
        const items = keys.map(key => {
            const symbol = this.provider.getSymbol(key)!
            const item = new CompletionItem(
                { label: `${leader}${key}`, description: symbol },
                CompletionItemKind.Text,
            )
            item.insertText = symbol
            item.filterText = `${leader}${key}`
            item.detail = symbol
            item.documentation = `Unicode input: ${leader}${key} ↦ ${symbol}`
            item.sortText = key
            item.range = replaceRange
            return item
        })
        // Mark incomplete so VS Code re-queries as more of the abbreviation is typed.
        return new CompletionList(items, true)
    }
}

/** Bundles the Unicode input method: the rewriter, completions, command and config reload. */
export class AbbreviationFeature implements Disposable {
    private readonly provider = new AbbreviationProvider()
    private readonly outerDisposables: Disposable[] = []
    private active: Disposable[] = []
    private rewriter: AbbreviationRewriter | undefined

    constructor(_context: ExtensionContext) {
        this.outerDisposables.push(
            commands.registerCommand('aeon.input.convert', async () => {
                await this.rewriter?.convert()
            }),
            workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('aeon.input')) {
                    this.reload()
                }
            }),
        )
        this.reload()
    }

    private reload(): void {
        for (const d of this.active) {
            d.dispose()
        }
        this.active = []
        this.rewriter = undefined

        const config = getAbbreviationConfig()
        if (!config.enabled) {
            return
        }

        this.rewriter = new AbbreviationRewriter(LANGUAGE_ID, config, this.provider)
        this.active.push(
            this.rewriter,
            languages.registerCompletionItemProvider(
                { language: LANGUAGE_ID },
                new AbbreviationCompletionProvider(config, this.provider),
                config.leader,
            ),
        )
    }

    dispose(): void {
        for (const d of this.active) {
            d.dispose()
        }
        for (const d of this.outerDisposables) {
            d.dispose()
        }
    }
}
