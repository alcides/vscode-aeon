# Development

This page is designed for software developers who are helping to develop the Aeon VS Code extension.

### Building
- Use Node.js 20, matching CI, with its bundled npm.
- Run `npm ci` in your workspace root folder to install the locked dependencies.
- Run `npm run typecheck` to check the extension with TypeScript 7.
- Run `npm run build`. This type-checks and compiles the extension, as it does in CI.
- Run `npm test` to run the extension's tests.

### TypeScript compiler and tooling

Both workspace manifests use the [TypeScript team's compatibility setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0):

- `@typescript/native` aliases TypeScript 7 and provides `tsc` for type-checking.
- `typescript` aliases `@typescript/typescript6`, which provides the TypeScript 6
  JavaScript API required by `typescript-eslint` and `prettier-plugin-organize-imports`.
  Its separate compiler executable is named `tsc6`.

Keep these aliases aligned in the root and extension manifests. Replacing the
`typescript` alias with version 7 breaks the tooling's peer dependencies and API
access. `npm ci` should work without `--force` or `--legacy-peer-deps`.

The workspace's `typescript.tsdk` setting points to the compatibility package's
underlying TypeScript 6 language service. Esbuild still produces the extension's
CommonJS bundle; the TypeScript configuration uses bundler resolution for
type-checking without emitting files.

### Debugging
- Complete the 'Building' instructions above.
- Open VS Code on this folder.
- Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> to compile the extension. (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on macos.) This step is needed for a working development setup.
- Press F5 to launch the extension in the VS Code debugger.

To debug the tests, use the launch configuration named `Extension Tests - SuiteName`.

## Updating synthesis algorithms

The live Refactor menu and Synthesis tab use the connected language server's
complete algorithm list, labels, and family order. VS Code's Settings editor
requires a static schema in `package.json`. Refresh that schema and the legacy
ID aliases from an Aeon checkout with its dependencies installed:

```sh
PYTHONPATH=/path/to/aeon /path/to/aeon/.venv/bin/python scripts/sync-synthesizers.py
PYTHONPATH=/path/to/aeon /path/to/aeon/.venv/bin/python scripts/sync-synthesizers.py --check
npm test
```

Commit the generated `vscode-aeon/package.json` and
`vscode-aeon/src/synthesisAliases.json`. No backend list is hard-coded in the
live Synthesis tab, so newly registered server algorithms appear automatically.

## Packaging the extension

To publish the extension on the VS Code marketplace you should run the `./release.sh` script. See [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for more information.

You can build a local .vsix for testing using `npm run package` in the `vscode-aeon/` subdirectory. This gives you a .vsix which you can install using the VS Code command `Extensions: Install from VSIX...`.
