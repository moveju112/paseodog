import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import {
    WINDOWS_INSTALLER_VERSION, WINDOWS_INSTALLER_BLOBS, withWindowsInstallerSources,
    WINDOWS_UNINSTALLER_BLOB, withWindowsUninstaller, withoutWindowsUninstaller,
} from '../patches/windows-installer.mjs';

const builder = fileURLToPath(new URL('../android/node_modules/app-builder-lib/', import.meta.url));

// node_modules는 변경하지 않고 검토한 네 파일을 빌드 출력의 독립 설치 스크립트로 조합한다.
export function windowsInstallerScript(root = builder) {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (manifest.version !== WINDOWS_INSTALLER_VERSION) {
        throw new Error(`app-builder-lib ${WINDOWS_INSTALLER_VERSION} required`);
    }
    const sources = {};
    for (const [file, blob] of Object.entries(WINDOWS_INSTALLER_BLOBS)) {
        const source = readFileSync(join(root, 'templates/nsis', file), 'utf8');
        if (gitBlob(source) !== blob) throw new Error(`Windows installer source hash mismatch: ${file}`);
        sources[file] = source;
    }
    return withWindowsInstallerSources(sources);
}

export function prepareWindowsInstaller(output, { check = false } = {}) {
    const source = windowsInstallerScript();
    const target = join(builder, 'out/targets/nsis/NsisTarget.js');
    const installed = readFileSync(target, 'utf8');
    const original = withoutWindowsUninstaller(installed);
    if (gitBlob(original) !== WINDOWS_UNINSTALLER_BLOB)
        throw new Error('Windows uninstaller builder source hash mismatch');
    const patched = withWindowsUninstaller(original);
    if (check) {
        if (readFileSync(output, 'utf8') !== source) throw new Error('Windows installer patch is missing');
        if (installed !== patched) throw new Error('Windows uninstaller builder patch is missing');
    } else {
        if (installed !== patched) writeFileSync(target, patched);
        writeFileSync(output, source);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const output = process.argv[2];
        if (!output) throw new Error('Usage: patch-windows-installer.mjs <existing-build-directory>/installer.nsi [--check]');
        prepareWindowsInstaller(resolve(output), { check: process.argv.includes('--check') });
        console.log('Windows installer long-path file copy: OK');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
