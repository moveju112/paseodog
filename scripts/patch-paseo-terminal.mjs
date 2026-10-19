#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// getpaseo/paseo PR #6452, head 3b726e5d43a0c44f940296fe79db28c1045991cd.
// 서버 직렬화 두 곳만 0.11.4 배포 JS에 이식; 프로토콜 필드·입력 경로는 변경하지 않음.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SERVER_VERSION = '0.11.4';
export const SERVER_ROOT = fileURLToPath(new URL('../tools/node_modules/@getpaseo/server/', import.meta.url));
export const TERMINAL_FILE = 'dist/server/terminal/terminal.js';
export const ORIGINAL_HASH = '44bd0fb2a6ff3f22cef6d93bedec6588bee4fbfb9efdd39fc9996db6cf06a30e';
export const BEFORE = 'char: cell.getChars() || " ",';
export const AFTER = 'char: cell.getWidth() === 0 ? "" : cell.getChars() || " ",';

// 전체 원본 해시 확인 -> 뷰포트·스크롤백의 연속 셀만 보존.
export function patchTerminalSource(source) {
    const hash = value => createHash('sha256').update(value).digest('hex');
    if (hash(source) === ORIGINAL_HASH) {
        if (source.split(BEFORE).length !== 3) throw new Error('Missing two terminal snapshot anchors');
        return source.replaceAll(BEFORE, AFTER);
    }
    if (source.split(AFTER).length === 3 && hash(source.replaceAll(AFTER, BEFORE)) === ORIGINAL_HASH) {
        return source;
    }
    throw new Error(`Paseo terminal source drift; expected audited SHA-256 ${ORIGINAL_HASH}`);
}

// 버전·바이트 게이트 통과 -> 설치 또는 설치 상태 검증.
export async function patchInstalledTerminal(mode, root = SERVER_ROOT) {
    if (!['--apply', '--check'].includes(mode)) throw new Error('Expected --apply or --check');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== '@getpaseo/server' || manifest.version !== SERVER_VERSION) {
        throw new Error(`Expected @getpaseo/server ${SERVER_VERSION}; refusing version drift`);
    }
    const filename = join(root, TERMINAL_FILE);
    const source = await readFile(filename, 'utf8');
    const patched = patchTerminalSource(source);
    if (mode === '--check' && source !== patched) throw new Error('Paseo terminal snapshot patch is not installed');
    if (mode === '--apply' && source !== patched) await writeFile(filename, patched, 'utf8');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.error('Usage: node scripts/patch-paseo-terminal.mjs --apply|--check');
        process.exitCode = 1;
    } else {
        patchInstalledTerminal(args[0]).then(
            () => console.log(`Paseo server ${SERVER_VERSION}: ${args[0]} terminal snapshot patch verified`),
            error => { console.error(error.message); process.exitCode = 1; },
        );
    }
}
