import abbreviations from './abbreviations.json'

/**
 * Wraps the abbreviation table and answers the queries the rewriter and completion
 * provider need. Abbreviation keys do NOT include the leader character.
 */
export class AbbreviationProvider {
    private readonly symbolsByAbbreviation: Record<string, string>
    private readonly sortedKeys: string[]

    constructor(table: Record<string, string> = abbreviations) {
        this.symbolsByAbbreviation = table
        this.sortedKeys = Object.keys(table).sort()
    }

    /** The Unicode symbol for an exact abbreviation, or undefined if there is none. */
    getSymbol(abbreviation: string): string | undefined {
        return Object.prototype.hasOwnProperty.call(this.symbolsByAbbreviation, abbreviation)
            ? this.symbolsByAbbreviation[abbreviation]
            : undefined
    }

    /** True if `abbreviation` maps to a symbol exactly. */
    isExact(abbreviation: string): boolean {
        return this.getSymbol(abbreviation) !== undefined
    }

    /** True if some abbreviation key starts with `prefix` (the empty string matches all). */
    isPrefix(prefix: string): boolean {
        if (prefix.length === 0) {
            return this.sortedKeys.length > 0
        }
        return this.sortedKeys.some(key => key.startsWith(prefix))
    }

    /** True if some abbreviation key is strictly longer than `prefix` but starts with it. */
    hasLongerExtension(prefix: string): boolean {
        return this.sortedKeys.some(key => key.length > prefix.length && key.startsWith(prefix))
    }

    /** All abbreviation keys whose name starts with `prefix`, sorted. */
    matchingKeys(prefix: string): string[] {
        if (prefix.length === 0) {
            return this.sortedKeys
        }
        return this.sortedKeys.filter(key => key.startsWith(prefix))
    }

    get allKeys(): string[] {
        return this.sortedKeys
    }
}
