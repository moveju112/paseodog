import { mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { writeFileAtomicSync } from './util.mjs';

// PaseoDog 전용 호스트 설정은 전용 엔진 데이터 폴더에만 저장한다.
function settingPath(env, file) {
    const root = env.MIXDOG_DATA_DIR;
    if (!root || !isAbsolute(root)) throw new Error('Dedicated engine data directory required');
    return join(root, file);
}

// 데이터 폴더나 파일이 없으면 undefined를 돌려 호출자가 기본값을 쓰게 한다. 손상된 파일은 오류로 드러낸다.
export function readDedicatedSetting(env, file) {
    if (!env.MIXDOG_DATA_DIR) return undefined;
    const path = settingPath(env, file);
    let text;
    try { text = readFileSync(path, 'utf8'); }
    catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
    return JSON.parse(text);
}

// 임시 파일을 fsync한 뒤 rename해 중단 시에도 이전 값 또는 새 값만 남긴다.
export function writeDedicatedSetting(env, file, value) {
    const path = settingPath(env, file);
    mkdirSync(env.MIXDOG_DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomicSync(path, JSON.stringify(value) + '\n');
}
