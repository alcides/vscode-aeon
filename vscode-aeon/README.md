# Aeon VS Code Extension

This extension provides VS Code support for the [Aeon programming language](https://alcides.github.io/aeon/).

## Features

- **Syntax highlighting** — full syntax highlighting for `.ae` files
- **Diagnostics** — type errors and parse errors shown inline as you type
- **Hover types** — hover over any identifier to see its inferred type
- **Hole synthesis** — place a `?holeName` in your code, then use *Refactor…* (or the lightbulb) to synthesize a solution with your chosen synthesizer

## Synthesizers

The *Refactor* code-action menu and the Info View's **Synthesis** tab show every
algorithm advertised by the connected Aeon language server, grouped by family:
type-directed, example-driven, constraint solving, automata, grammar search,
metaheuristic, and LLM-assisted synthesis. This includes Synquid, decision trees,
Contata, CP-SAT, BUSTLE, AMaze, ReGuS, bounded Boolean synthesis, and each supported
LLM backend/model. See the [compiler's synthesizer guide](https://github.com/alcides/aeon/blob/master/docs/synthesizers.md)
for each algorithm's specifications and optional dependencies.

Set `aeon.defaultSynthesizer` in Settings to choose from the complete algorithm
catalogue. The selected backend appears first in code actions. Existing CLI
aliases such as `tdsyn`, `cpsat`, and `llm` still select their canonical backend.
The live menus use the installed compiler's list, so update Aeon (or set
`aeon.localPackagePath` to a current checkout) to use newly added algorithms.

Requires **AeonLang 4.5.1** or newer on PyPI (or a local checkout via `aeon.localPackagePath`). The extension invokes the compiler exclusively through **`uv` / `uvx`** — no system Python or managed venv is used.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `aeon.localPackagePath` | `""` | Path to a local `aeon` source tree (uses `uvx --from <path>`) |
| `aeon.defaultSynthesizer` | `"gp"` | Preferred synthesizer shown first in the code-action menu |

## Acknowledgements

This project is based on [vscode-lean4](https://github.com/leanprover/vscode-lean4).
