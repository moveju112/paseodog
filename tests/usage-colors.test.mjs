import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, DESKTOP_COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { USAGE_COLORS, USAGE_COLORS_ANCHOR, withUsageColors, withoutUsageColors } from '../patches/paseo-usage-colors.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const current = withoutUsageColors(composerFixture(installed));
import { composerFixture } from './composer-fixture.mjs';

// 번들에서 UsageMeter 모듈 팩토리를 잘라 대역 의존성으로 실행하고 채움 스타일 이름을 돌려준다.
function renderFill(source, props) {
    const at = source.indexOf('e.UsageMeter=function');
    const start = source.lastIndexOf('__d(', at) + 4;
    const end = source.indexOf('\n__d(', at);
    const factory = new Function(`return ${source.slice(start, source.lastIndexOf('},', end) + 1)}`)();
    const theme = { colors: {}, borderRadius: { full: 9 } };
    const stubs = [{ View: 'view' }, { c: (size) => new Array(size) }, {}, {}, {
        StyleSheet: { create: (build) => Object.fromEntries(Object.keys(build(theme)).map((key) => [key, key])) },
    }, { clampPct: (value) => Math.max(0, Math.min(100, value)) }, { jsx: (type, props) => ({ type, props }) }];
    const module = {};
    factory(null, (value) => value, null, null, null, module, stubs);
    return module.UsageMeter(props).props.children.props.style;
}

test('sidebar quiet usage meters reuse host windowTone fill colors', () => {
    assert.equal(withoutUsageColors(current), current);
    const patched = withUsageColors(current);
    assert.equal(patchedComposerSource(installed), patched);
    new Script(patched);
    assert.equal(patched.split(USAGE_COLORS).length, 2);
    assert.equal(withoutUsageColors(withoutUsageColors(patched)), current);
    assert.equal(withUsageColors(withoutUsageColors(patched)), patched);
    assert.throws(() => withUsageColors(patched), /anchor mismatch/);
    assert.throws(() => withUsageColors(current.replace(USAGE_COLORS_ANCHOR, '')), /anchor mismatch/);
    assert.throws(() => withoutUsageColors(patched + USAGE_COLORS), /drift/);
    // 원본 사이드바는 단계와 무관하게 회색이고, 패치 후 단계별 색과 정확한 너비가 유지된다.
    assert.deepEqual(renderFill(current, { percent: 79, tone: 'warning', quiet: true }), ['fill', 'fillQuiet', { width: '79%' }]);
    for (const [tone, fill] of [['default', 'fillDefault'], ['warning', 'fillWarning'], ['danger', 'fillDanger'], ['ok', 'fillOk']]) {
        assert.deepEqual(renderFill(patched, { percent: 44, tone, quiet: true }), ['fill', fill, { width: '44%' }]);
        assert.deepEqual(renderFill(patched, { percent: 44, tone }), ['fill', fill, { width: '44%' }]);
    }
    // 단계 기준은 호스트 windowTone(>90 위험, >=70 경고) 원문 그대로다.
    assert.ok(patched.includes('u>90?"danger":u>=70?"warning":"default"'));
});

test('reviewed desktop bundle has the same single usage meter anchor', { skip: !existsSync(DESKTOP_COMPOSER_FILE) }, () => {
    const desktop = withoutUsageColors(patchedComposerSource(readFileSync(DESKTOP_COMPOSER_FILE, 'utf8')));
    const patched = withUsageColors(desktop);
    assert.equal(withoutUsageColors(patched), desktop);
    assert.deepEqual(renderFill(patched, { percent: 79, tone: 'warning', quiet: true }), ['fill', 'fillWarning', { width: '79%' }]);
});
