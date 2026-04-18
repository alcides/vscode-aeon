# Aeon VS Code Extension

This extension provides VS Code support for the [Aeon programming language](https://alcides.github.io/aeon/).

## Features

- **Syntax highlighting** — full syntax highlighting for `.ae` files
- **Diagnostics** — type errors and parse errors shown inline as you type
- **Hover types** — hover over any identifier to see its inferred type
- **Hole synthesis** — place a `?holeName` in your code, then use *Refactor…* (or the lightbulb) to synthesize a solution with your chosen synthesizer

## Synthesizers

When synthesizing a hole the following backends are available via the *Refactor* code-action menu:

| Identifier | Description |
|---|---|
| `gp` | Genetic programming *(default)* |
| `enumerative` | Exhaustive enumerative search |
| `random_search` | Random program search |
| `synquid` | SMT-based Synquid synthesis |
| `hc` | Hill climbing |
| `1p1` | One-plus-one evolutionary strategy |
| `smt` | SMT-guided synthesis via z3 (best for arithmetic/boolean constraints) |
| `decision_tree` | Decision tree regressor fitted from `@csv_data` examples |
| `llm` | LLM-based synthesis via Ollama |

You can set a preferred synthesizer via the `aeon.defaultSynthesizer` setting — it will appear first in the code-action list.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `aeon.environmentPath` | `""` | Path to the Python environment where `aeonlang` is installed |
| `aeon.useSystemInterpreter` | `false` | Use the system-wide `aeon` interpreter instead of the managed venv |
| `aeon.localPackagePath` | `""` | Path to a local `aeon` source tree (uses `uvx --from <path>`) |
| `aeon.defaultSynthesizer` | `"gp"` | Preferred synthesizer shown first in the code-action menu |

## Acknowledgements

This project is based on [vscode-lean4](https://github.com/leanprover/vscode-lean4).
