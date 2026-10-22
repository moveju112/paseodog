import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import {
    EXPO_ACTIVITY_RESULT_VERSION, EXPO_ACTIVITY_RESULT_FILE, EXPO_ACTIVITY_RESULT_BLOB,
    withoutExpoActivityResult, withExpoActivityResult,
} from '../patches/expo-activity-result.mjs';

// 버전·전체 원본 해시를 먼저 확인하고 완전 적용 상태만 허용한다.
export function patchedExpoActivityResult(source) {
    const original = withoutExpoActivityResult(source);
    if (gitBlob(original) !== EXPO_ACTIVITY_RESULT_BLOB) throw new Error('Expo activity result source hash mismatch');
    const result = withExpoActivityResult(original);
    if (source !== original && source !== result) throw new Error('Partial Expo activity result patch');
    return result;
}

// Android 의존성의 검토 파일만 쓰며 검사 모드는 절대 파일을 변경하지 않는다.
export function patchExpoActivityResult(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== EXPO_ACTIVITY_RESULT_VERSION) {
        throw new Error(`expo-modules-core ${EXPO_ACTIVITY_RESULT_VERSION} required`);
    }
    const path = resolve(root, EXPO_ACTIVITY_RESULT_FILE);
    const source = readFileSync(path, 'utf8');
    const result = patchedExpoActivityResult(source);
    if (check && source !== result) throw new Error('Expo activity result patch is missing');
    if (!check && source !== result) writeFileSync(path, result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        patchExpoActivityResult(fileURLToPath(new URL('../android/node_modules/expo-modules-core/', import.meta.url)),
            { check: process.argv.includes('--check') });
        console.log('Expo activity result lifecycle: OK');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
