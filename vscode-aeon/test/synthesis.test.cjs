const assert = require('node:assert/strict')
const { test } = require('node:test')
const { configureSynthesisActions, groupSynthesizers } = require('../out/synthesis.cjs')
const aliases = require('../src/synthesisAliases.json')
const manifest = require('../package.json')

const action = (id, title = 'Readable algorithm name') => ({
    title,
    command: { title, command: 'aeon.synthesize', arguments: ['file:///test.ae', 'hole', id] },
})

test('all configured algorithms remain available and preference uses the ID, not the label', () => {
    const settings = manifest.contributes.configuration.properties['aeon.defaultSynthesizer']
    const ids = settings.enum.filter(id => !(id in aliases))
    const actions = ids.map(id => action(id))
    for (const preferred of ids) {
        const result = configureSynthesisActions(actions, preferred, 30)
        assert.equal(result[0].command.arguments[2], preferred)
        assert.deepEqual(
            result.map(a => a.command.arguments[2]),
            [preferred, ...ids.filter(id => id !== preferred)],
        )
        assert.ok(result.every(a => a.command.arguments[3] === 30))
    }
    assert.ok(
        actions.every(a => a.command.arguments.length === 3),
        'does not mutate server responses',
    )
    assert.equal(settings.enum.length, settings.enumDescriptions.length)
    assert.equal(new Set(settings.enum).size, settings.enum.length)
    assert.ok(settings.enum.includes(settings.default))
    for (const id of [
        'ortools',
        'contata',
        'decision_tree',
        'amaze',
        'regus',
        'boolean_bounded',
        'llm_type_constrained',
    ]) {
        assert.ok(ids.includes(id), id)
    }
    assert.ok(!ids.includes('hc') && !ids.includes('1p1'))
})

test('legacy aliases select their canonical algorithms', () => {
    for (const [alias, canonical] of Object.entries(aliases)) {
        const result = configureSynthesisActions([action('gp'), action(canonical)], alias, 15)
        assert.equal(result[0].command.arguments[2], canonical)
    }
})

test('unrecognized preferences preserve ordering, unrelated actions and explicit budgets', () => {
    const unrelated = { title: 'with gp', command: 'some.other.command', arguments: [] }
    const disabled = { title: 'Unavailable', disabled: { reason: 'No hole' } }
    const direct = {
        title: 'Genetic programming',
        command: 'aeon.synthesize',
        arguments: ['file:///t.ae', 'h', 'gp', 45],
    }
    const actions = [unrelated, action('smt'), disabled, direct]
    const result = configureSynthesisActions(actions, 'unknown', 30)
    assert.deepEqual(
        result.map(a => a.title),
        actions.map(a => a.title),
    )
    assert.equal(result[0], unrelated)
    assert.equal(result[2], disabled)
    assert.equal(result[3].arguments[3], 45)
    assert.equal(configureSynthesisActions(actions, 'gp', 30)[0].command, 'aeon.synthesize')
})

test('Info View preserves every backend and the family order sent by the server', () => {
    const algorithms = [
        { id: 'tdsyn_enumerative', label: 'Type-directed BFS', family: 'Type-directed' },
        { id: 'contata', label: 'Contata', family: 'Example-driven' },
        { id: 'decision_tree', label: 'Decision tree', family: 'Example-driven' },
        { id: 'ortools', label: 'CP-SAT', family: 'Constraint solving' },
        { id: 'future', label: 'A new backend', family: 'A new family' },
    ]
    const groups = groupSynthesizers(algorithms)
    assert.deepEqual([...groups.keys()], ['Type-directed', 'Example-driven', 'Constraint solving', 'A new family'])
    assert.deepEqual([...groups.values()].flat(), algorithms)
    assert.deepEqual([...groupSynthesizers([])], [])
    assert.ok(groupSynthesizers([{ id: 'old', label: 'Legacy server', family: '' }]).has('Other'))
})
