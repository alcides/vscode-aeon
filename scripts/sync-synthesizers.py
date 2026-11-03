"""Refresh VS Code's static settings schema from an installed Aeon checkout.

Run with the checkout on PYTHONPATH; use --check to detect stale metadata.
The live code actions and Info View always use the connected server's list.
"""

import argparse
import json
from pathlib import Path

from aeon.synthesis.modules.synthesizerfactory import (
    SYNTHESIZER_ALIASES,
    synthesizer_family_label,
    synthesizer_label,
    synthesizer_menu_ids,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    extension = Path(__file__).resolve().parents[1] / "vscode-aeon"
    manifest_path = extension / "package.json"
    manifest = json.loads(manifest_path.read_text())
    setting = manifest["contributes"]["configuration"]["properties"]["aeon.defaultSynthesizer"]
    ids = synthesizer_menu_ids()
    descriptions = [f"{synthesizer_family_label(sid)}: {synthesizer_label(sid)}" for sid in ids]
    # Existing settings using CLI aliases remain valid, but the live menus show
    # just the canonical backend. Export aliases for preference matching too.
    for alias, canonical in SYNTHESIZER_ALIASES.items():
        ids.append(alias)
        descriptions.append(f"Alias for {canonical}: {synthesizer_label(canonical)}")
    setting["enum"] = ids
    setting["enumDescriptions"] = descriptions
    generated = {
        manifest_path: json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        extension / "src" / "synthesisAliases.json": json.dumps(SYNTHESIZER_ALIASES, indent=4) + "\n",
    }
    for path, content in generated.items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f"Stale synthesis metadata: {path}. Run scripts/sync-synthesizers.py.")
        else:
            path.write_text(content)


if __name__ == "__main__":
    main()
