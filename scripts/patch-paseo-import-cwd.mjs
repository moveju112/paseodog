// 로컬 패치: Paseo 0.11.4 공유 앱 소스에서 프로젝트 경로를 가져오기 요청에 연결한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import { SOURCE_IMPORT_CWD_ANCHOR, SOURCE_IMPORT_CWD } from '../patches/paseo-import-cwd.mjs';

export const IMPORT_SOURCE_FILE = 'packages/app/src/screens/new-workspace-screen.tsx';
const ORIGINAL_BLOB = 'c919ab476d43b4af246e43ef2a6defda26992852';

// 기존 패치를 되돌린 정확한 소스 해시를 확인한 뒤 호출 하나만 수정한다.
export function patchedImportSource(source) {
    const original = source.replace(SOURCE_IMPORT_CWD, () => SOURCE_IMPORT_CWD_ANCHOR);
    if (gitBlob(original) !== ORIGINAL_BLOB) throw new Error('Paseo import source hash mismatch');
    if (original.split(SOURCE_IMPORT_CWD_ANCHOR).length !== 2) throw new Error('Paseo import source anchor mismatch');
    return original.replace(SOURCE_IMPORT_CWD_ANCHOR, () => SOURCE_IMPORT_CWD);
}

// 빌드 전 명시한 공유 소스 체크아웃만 패치하며 설치 앱·데몬은 건드리지 않는다.
export function patchPaseoImportSource(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'packages/app/package.json'), 'utf8'));
    if (manifest.version !== '0.11.4') throw new Error('Paseo 0.11.4 required');
    const path = resolve(root, IMPORT_SOURCE_FILE);
    const source = readFileSync(path, 'utf8');
    const result = patchedImportSource(source);
    if (check && source !== result) throw new Error('Paseo import cwd source patch is missing');
    if (!check && source !== result) writeFileSync(path, result);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    const [mode, root, ...extra] = process.argv.slice(2);
    if (!['--apply', '--check'].includes(mode) || !root || extra.length)
        throw new Error('Usage: node scripts/patch-paseo-import-cwd.mjs --apply|--check <Paseo source root>');
    patchPaseoImportSource(resolve(root), { check: mode === '--check' });
}
