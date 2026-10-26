import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { patchedComposerSource, COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
let fixture;

// 테스트 실행기가 그 실행에서 실제 패치·해시·멱등 검사를 마친 공통 입력만 공유한다.
// 원본 변형·이전 버전·부분 패치·drift 검사는 항상 실제 구현을 호출한다.
export function composerFixture(source) {
    const directory = process.env.PASEODOG_TEST_COMPOSER_FIXTURE;
    if (!directory) return patchedComposerSource(source);
    if (!fixture) {
        const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
        const patched = readFileSync(join(directory, 'patched.js'), 'utf8');
        if (digest(patched) !== receipt.output) throw new Error('Shared composer fixture is corrupt');
        fixture = { ...receipt, patched };
    }
    const hash = digest(source);
    if (hash !== fixture.input && hash !== fixture.output) return patchedComposerSource(source);
    return fixture.patched;
}

export function installedComposerFixture() {
    return composerFixture(readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8'));
}
