import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSharedAppTests } from './shared-app-tests.mjs';

// 실제 팔레트·테마 순서·입력창 대비·설정 저장 복원은 공통 소스 검사로 연결한다.
test('shared theme catalog and persisted settings preserve approved palettes', () =>
    runSharedAppTests(['src/styles/theme.test.ts', 'src/hooks/use-settings/storage.test.ts']));

test('every shared locale retains the three added light-theme labels', () => {
    for (const locale of ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN']) {
        const source = readFileSync(new URL(`../android/packages/app/src/i18n/resources/${locale}.ts`, import.meta.url), 'utf8');
        for (const key of ['white2', 'neutralPearl', 'softLinen'])
            assert.match(source, new RegExp(`${key}: "[^"]+"`), locale);
    }
});
