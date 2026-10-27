#!/usr/bin/env python3
"""Create update metadata from built APKs without publishing anything."""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path


def manifest(version, name, tag, apks, target_abi=None):
    if version <= 0 or not name.strip() or not re.fullmatch(r"[A-Za-z0-9._-]+", tag):
        raise ValueError("Invalid release version or tag")
    if target_abi is not None and (target_abi != "arm64-v8a" or len(apks) != 1):
        raise ValueError("Targeted release requires exactly one arm64-v8a APK")
    artifacts, universal = [], None
    supported = {"armeabi-v7a", "arm64-v8a", "x86", "x86_64"}
    seen = set()
    for file in apks:
        if not re.fullmatch(r"[A-Za-z0-9._-]+\.apk", file.name):
            raise ValueError("Unsafe APK filename")
        with zipfile.ZipFile(file) as archive:
            abis = {p.split("/")[1] for p in archive.namelist() if p.startswith("lib/") and p.endswith(".so")}
        if not abis or not abis <= supported:
            raise ValueError(f"Unsupported APK architectures: {file}")
        if target_abi is not None and abis != {target_abi}:
            raise ValueError("Targeted release requires an actual arm64-v8a-only APK")
        with file.open("rb") as source:
            # Python 3.10 호스트에서도 APK 전체 바이트를 같은 SHA256으로 검증한다.
            # 큰 APK를 메모리에 모두 적재하지 않도록 고정 크기로 읽는다.
            checksum = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                checksum.update(chunk)
            digest = checksum.hexdigest()
        row = {
            "url": f"https://github.com/moveju112/paseodog/releases/download/{tag}/{file.name}",
            "sha256": digest,
            "size": file.stat().st_size,
        }
        if len(abis) == 1:
            abi = next(iter(abis))
            if abi in seen:
                raise ValueError(f"Duplicate ABI: {abi}")
            seen.add(abi)
            artifacts.append({**row, "abi": abi})
            if target_abi is not None:
                universal = row
        else:
            if universal is not None or abis != supported:
                raise ValueError("Expected one complete compatibility APK")
            universal = row
    if universal is None or seen != ({target_abi} if target_abi is not None else supported):
        raise ValueError("All four split APKs and a universal compatibility APK are required")
    return {"versionCode": version, "versionName": name, **universal,
            "artifacts": sorted(artifacts, key=lambda row: row["abi"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target-abi", choices=["arm64-v8a"],
                        help="Explicit S25-only release; requires exactly one arm64-v8a APK")
    parser.add_argument("apks", type=Path, nargs="+")
    args = parser.parse_args()
    result = manifest(args.version_code, args.version_name, args.tag, args.apks, args.target_abi)
    with args.output.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
