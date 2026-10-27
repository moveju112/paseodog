import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runSharedAppTests } from './shared-app-tests.mjs';
const { transformSync } = createRequire(new URL('../android/package.json', import.meta.url))('esbuild');
const androidResources = new URL('../android/packages/app/src/i18n/resources/', import.meta.url);

// 공유 projection에서 진행 중/완료 상태·모든 상세 수준·원본 불변성·다시 표시를 검증한다.
// 저장 스키마의 기본 꺼짐과 명시적 선택 복원도 실제 저장기 테스트로 연결한다.
test('shared presentation and storage preserve explicit reasoning visibility', () =>
    runSharedAppTests(['src/agent-stream/presentation.test.ts', 'src/hooks/use-settings/storage.test.ts']));

test('chat settings card shows the hide switch below reasoning expansion and updates on every render', () => {
    const memo = [];
    let settings = { autoExpandReasoning: false, hideReasoning: false, toolCallDetailLevel: 'detailed', chatOutlineEnabled: true };
    const updates = [];
    const stub = {
        // React 컴파일러 메모 캐시처럼 렌더 사이에 같은 배열을 유지한다.
        c: (size) => {
            if (!memo.length) memo.push(...Array(size).fill(Symbol.for('react.memo_cache_sentinel')));
            return memo;
        },
        useMemo: fn => fn(), useCallback: fn => fn,
        useTranslation: () => ({ t: (key) => key }),
        useAppSettings: () => ({ settings, updateSettings: (update) => updates.push(update) }),
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        SettingsSwitch: 'SettingsSwitch', SettingsCard: 'SettingsCard', SettingsSection: 'SettingsSection', SettingsSelect: 'SettingsSelect',
        View: 'View', isNative: false,
    };
    const source = readFileSync(new URL('../android/packages/app/src/screens/settings/chat/chat-section.tsx', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'tsx', format: 'cjs', jsxFactory: 'element' }).code;
    const module = { exports: {} };
    const element = (type, props, ...children) => ({ type, props: { ...props,
        children: children.length === 1 ? children[0] : children } });
    new Function('module', 'exports', 'require', 'element', code)(module, module.exports, () => stub, element);
    const { ChatSection } = module.exports;
    const card = () => ChatSection().props.children.props.children;
    const controls = () => card().props.children.filter(child =>
        ['settings.general.autoExpandReasoning.label', 'settings.general.hideReasoning.label',
            'settings.general.toolCallDetail.label', 'settings.appearance.chatOutline.title'].includes(child?.props?.label));
    const labels = () => controls().map((child) => [child.type, child.props.label, child.props.value]);
    assert.deepEqual(labels(card()), [
        ['SettingsSwitch', 'settings.general.autoExpandReasoning.label', false],
        ['SettingsSwitch', 'settings.general.hideReasoning.label', false],
        ['SettingsSelect', 'settings.general.toolCallDetail.label', 'detailed'],
        ['SettingsSwitch', 'settings.appearance.chatOutline.title', true],
    ]);
    controls()[1].props.onValueChange(true);
    assert.deepEqual(updates, [{ hideReasoning: true }]);
    settings = { ...settings, hideReasoning: true };
    assert.equal(controls()[1].props.value, true);
    assert.equal(controls()[1].props.hint, 'settings.general.hideReasoning.description');
});

test('web locale strings match the shared Android resources for every language', () => {
    const files = ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN'];
    const strings = files.map((name) => {
        const text = readFileSync(new URL(`${name}.ts`, androidResources), 'utf8');
        const block = /hideReasoning: \{\s*label: "([^"]+)",\s*description:\s*"([^"]+)",\s*\}/.exec(text);
        return [block[1], block[2]];
    });
    for (const [label, description] of strings) {
        assert.ok(label.trim());
        assert.ok(description.trim());
    }
});
