# Development

This page is designed for software developers who are helping to develop the Aeon VS Code extension.

### Building
- Make sure you have an up to date installation of `npm` and `node.js`.  For example `npm` version 8.1.3 and `node.js` version v16.13.0.
- Run `npm install` in your workspace root folder to set up the project's dependencies.
- Run `npm run build`. This compiles the extension.

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
