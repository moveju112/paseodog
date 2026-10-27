import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { transformSync } = createRequire(new URL('../android/package.json', import.meta.url))('esbuild');
// 실제 TS/TSX 모듈을 실행하고 네이티브 렌더링 경계만 대역으로 둔다.
function load(name, dependencies = {}) {
    const source = readFileSync(new URL('../android/packages/app/src/usage/' + name, import.meta.url), 'utf8');
    const code = transformSync(source, { loader: name.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'cjs', jsxFactory: 'element' }).code;
    const module = { exports: {} };
    const element = (type, props, child) => ({ type, props: { ...props, children: child } });
    new Function('module', 'exports', 'require', 'element', code)(
        module, module.exports, name => dependencies[name] ?? {}, element);
    return module.exports;
}
const model = load('model.ts');
const format = load('format.ts');
const { windowTone } = load('tone.ts', { './model': model });
const { UsageMeter } = load('meter.tsx', {
    react: { useMemo: fn => fn() }, 'react-native': { View: 'view' }, './format': format,
    'react-native-unistyles': { StyleSheet: { create: build =>
        Object.fromEntries(Object.keys(build({ colors: {}, borderRadius: { full: 9 } })).map(key => [key, key])) } },
});

test('shared quiet and ordinary meters preserve tone colors and clamped widths', () => {
    for (const quiet of [false, true])
        for (const [tone, fill] of [['default', 'fillDefault'], ['warning', 'fillWarning'], ['danger', 'fillDanger'], ['ok', 'fillOk']])
            for (const [percent, width] of [[44, '44%'], [-1, '0%'], [101, '100%']])
                assert.deepEqual(UsageMeter({ percent, tone, quiet }).props.children.props.style,
                    ['fill', fill, { width }]);
});
test('shared window tones preserve exact thresholds and explicit host colors', () => {
    for (const [usedPct, tone] of [[0, 'default'], [69, 'default'], [70, 'warning'], [90, 'warning'], [91, 'danger']])
        assert.equal(windowTone({ usedPct }), tone);
    assert.equal(windowTone({ remainingPct: 5 }), 'danger');
    assert.equal(windowTone({}), 'default');
    assert.equal(windowTone({ usedPct: 99, tone: 'ok' }), 'ok');
});
