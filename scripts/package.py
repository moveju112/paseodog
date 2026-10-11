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
# The reviewed manifest is an allowlist of source paths. A runtime directory,
# credential file or untracked artifact must never enter a source release.
MANIFEST = "MANIFEST.sha256"
ROOT_FILES = {".gitignore", "AGENTS.md", "CHANGELOG.md", "LICENSE", "NOTICE", "README.md", "package.json"}
ROOT_FOLDERS = {".github", "bin", "config", "docs", "engine", "plugin", "reports", "scripts", "tests", "tools"}
FORBIDDEN_PARTS = {"node_modules", ".git", "__pycache__", ".venv", "coverage", "state", "states", "tmp", ".paseo", ".mixdog", "secrets"}
FORBIDDEN_NAMES = {".env", "auth.json", "credentials.json", "secrets.json", "token.json", "id_rsa", "id_ed25519"}


def source_files(root: Path) -> list[Path]:
    manifest = root / MANIFEST
    if not manifest.is_file() or manifest.is_symlink():
        raise RuntimeError("Source allowlist MANIFEST.sha256 is missing or unsafe")
    result, seen = [], set()
    for line in manifest.read_text().splitlines():
        digest, sep, name = line.partition("  ")
        if not sep or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise RuntimeError("Invalid reviewed manifest entry")
        relative = Path(name)
        parts = relative.parts
        if (not name or relative.is_absolute() or ".." in parts or name in seen
                or name == MANIFEST or any(part in FORBIDDEN_PARTS for part in parts)):
            raise RuntimeError(f"Unsafe release path: {name}")
        if not (name in ROOT_FILES or (parts[0] in ROOT_FOLDERS and len(parts) > 1)):
            raise RuntimeError(f"Non-source path in release allowlist: {name}")
        if (parts[-1].lower() in FORBIDDEN_NAMES or parts[-1].lower().endswith((".key", ".pem", ".p12", ".pfx", ".env"))):
            raise RuntimeError(f"Credential-like name in release allowlist: {name}")
        candidate = root
        for part in parts:
            candidate /= part
            if candidate.is_symlink():
                raise RuntimeError(f"Refusing symlink in release tree: {name}")
        if not candidate.is_file():
            raise RuntimeError(f"Reviewed release source missing: {name}")
        seen.add(name)
        result.append(candidate)
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
