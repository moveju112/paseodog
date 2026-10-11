#!/usr/bin/env python3
"""Package source and verification evidence, never dependencies or user state."""
from __future__ import annotations
import argparse
import hashlib
import json
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "coverage", "tmp", ".paseo", ".mixdog"}
EXCLUDED_NAMES = {".env", "MANIFEST.sha256"}

def source_files(root: Path) -> list[Path]:
    result = []
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue
        if path.is_symlink():
            raise RuntimeError(f"Refusing symlink in release tree: {relative}")
        if not path.is_file():
            continue
        name = path.name
        if name in EXCLUDED_NAMES or name.startswith(".env.") or ".local." in name:
            continue
        if name.endswith((".zip", ".tgz", ".log", ".tmp", ".pyc", ".pem", ".key")):
            continue
        result.append(path)
    return sorted(result, key=lambda p: p.relative_to(root).as_posix())

def package(root: Path, output: Path) -> dict:
    paths = source_files(root)
    entries = {p.relative_to(root).as_posix(): p.read_bytes() for p in paths}
    manifest = "".join(f"{hashlib.sha256(content).hexdigest()}  {name}\n" for name, content in entries.items()).encode()
    entries["MANIFEST.sha256"] = manifest
    output.parent.mkdir(parents=True, exist_ok=True)
    # Fixed release timestamp for deterministic archives; zip is a source artifact.
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in entries.items():
            info = zipfile.ZipInfo("paseodog/" + name, date_time=(2026, 10, 11, 0, 0, 0))
            info.create_system = 3
            executable = name.endswith(".sh") or name.startswith("bin/") or name.startswith("engine/bin/")
            info.external_attr = ((stat.S_IFREG | (0o755 if executable else 0o644)) << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Archive CRC validation failed")
    return {"path": str(output), "files": len(entries), "bytes": output.stat().st_size,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}

if __name__ == "__main__":
    version = json.loads((ROOT / "package.json").read_text())["version"]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / f"PaseoDog-v{version}.zip")
    args = parser.parse_args()
    print(json.dumps(package(ROOT, args.output.resolve()), indent=2))
