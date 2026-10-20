import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, DESKTOP_COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { HIDE_REASONING_EDITS, withHideReasoning, withoutHideReasoning } from '../patches/paseo-hide-reasoning.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = patchedComposerSource(installed);
const current = withoutHideReasoning(patched);
const androidResources = new URL('../android/packages/app/src/i18n/resources/', import.meta.url);

// Metro 모듈 하나를 시작 위치에서 잘라 실제 팩토리·id·의존성 id 목록으로 돌려준다.
function parseModule(source, start) {
    const text = source.slice(start + '\n__d('.length, source.indexOf('\n__d(', start + 1));
    const tail = /\},(\d+),\[([\d,]*)\]\);\s*$/.exec(text);
    return {
        id: Number(tail[1]),
        deps: tail[2] ? tail[2].split(',').map(Number) : [],
        factory: new Function(`return ${text.slice(0, tail.index + 1)}`)(),
    };
}

// 표지 문자열이 든 번들 모듈을 의존 모듈까지 번들 원문 그대로 실행한다(stub이 있으면 모든 의존성을 대역으로).
function loadModule(source, marker, stub) {
    const root = parseModule(source, source.lastIndexOf('\n__d(', source.indexOf(marker)));
    const cache = new Map();
    const load = (id) => {
        if (stub && id !== root.id) return stub;
        if (!cache.has(id)) {
            const module = id === root.id ? root : parseModule(source, source.lastIndexOf('\n__d(', source.indexOf(`},${id},[`)));
            const record = { exports: {} };
            cache.set(id, record);
            const importDefault = (dependency) => {
                const value = load(dependency);
                return value?.__esModule ? value.default : value;
            };
            module.factory(globalThis, load, importDefault, load, record, record.exports, module.deps);
        }
        return cache.get(id).exports;
    };
    return load(root.id);
}

const timestamp = (seed) => new Date(`2026-10-20T00:00:0${seed}.000Z`);
const thought = { kind: 'thought', id: 'thought-1', text: 'private chain of thought', status: 'ready', timestamp: timestamp(2) };
const liveThought = { ...thought, id: 'thought-2', status: 'loading', timestamp: timestamp(6) };
const tool = { kind: 'tool_call', id: 'tool-1', timestamp: timestamp(3), payload: { source: 'agent', data: {
    provider: 'paseodog', callId: 'call-1', name: 'bash', status: 'completed', error: null,
    detail: { type: 'unknown', input: { command: 'ls' }, output: { stdout: '' } } } } };
const sourceTail = Object.freeze([
    { kind: 'user_message', id: 'user-1', text: 'question', timestamp: timestamp(1) },
    thought,
    tool,
    { kind: 'notification', id: 'note-1', level: 'info', message: 'status', timestamp: timestamp(4) },
    { kind: 'assistant_message', id: 'answer-1', text: 'final answer', timestamp: timestamp(5) },
]);
const sourceHead = Object.freeze([liveThought, { kind: 'assistant_message', id: 'answer-2', text: 'live answer', timestamp: timestamp(7) }]);
const rows = (result) => [...result.tail, ...result.head];

test('hide reasoning patch is hash gated, idempotent and reversible', () => {
    new Script(patched);
    assert.equal(withoutHideReasoning(current), current);
    assert.equal(withHideReasoning(current), patched);
    assert.equal(patchedComposerSource(patched), patched);
    assert.equal(patchedComposerSource(current), patched);
    for (const [before, after] of HIDE_REASONING_EDITS) {
        assert.equal(patched.split(after).length, 2);
        assert.equal(current.split(before).length, 2);
    }
    assert.throws(() => withHideReasoning(patched), /anchor mismatch/);
    assert.throws(() => withoutHideReasoning(patched + HIDE_REASONING_EDITS[0][1]), /drift/);
    const partial = patched.replace(HIDE_REASONING_EDITS[3][1], HIDE_REASONING_EDITS[3][0]);
    assert.throws(() => withoutHideReasoning(partial), /Partial Paseo hide reasoning/);
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo hide reasoning/);
    const drifted = current.replace(HIDE_REASONING_EDITS[2][0], HIDE_REASONING_EDITS[2][0].replace('new WeakMap', 'new Map'));
    assert.throws(() => patchedComposerSource(drifted), /hash mismatch/);
});

test('chat presentation hides progress and tools, revealing only the completed final answer', () => {
    const original = loadModule(current, 'e.createStreamPresentation=');
    const { createStreamPresentation } = loadModule(patched, 'e.createStreamPresentation=');
    for (const level of ['detailed', 'overview']) {
        const present = createStreamPresentation();
        const input = { tail: sourceTail, head: sourceHead, transform: undefined, level, isTurnActive: true };
        const shown = present(input);
        // 기본(꺼짐)은 원본 번들과 같은 행을 그대로 보인다.
        assert.deepEqual(rows(shown), rows(original.createStreamPresentation()(input)));
        assert.deepEqual(rows(shown).filter((item) => item.kind === 'thought').map((item) => item.id), ['thought-1', 'thought-2']);
        const hidden = present({ ...input, hideReasoning: true });
        assert.deepEqual(rows(hidden).map((item) => item.kind), ['user_message']);
        const completed = present({ ...input, hideReasoning: true, isTurnActive: false });
        assert.deepEqual(rows(completed).map((item) => item.kind), ['user_message', 'assistant_message']);
        assert.deepEqual(rows(completed).filter((item) => item.kind === 'assistant_message').map((item) => item.text), ['live answer']);
        // 원본 스트림 배열은 그대로이며 다시 끄면 추론 행이 돌아온다.
        assert.equal(sourceTail.length, 5);
        assert.deepEqual(sourceHead, [liveThought, sourceHead[1]]);
        assert.deepEqual(rows(present(input)), rows(shown));
    }
});

test('hideReasoning is a persisted client setting that defaults off', async () => {
    const storage = loadModule(patched, 'autoExpandReasoning:f.z.boolean().catch(!1),hideReasoning');
    assert.equal(storage.DEFAULT_CLIENT_SETTINGS.hideReasoning, false);
    assert.equal(storage.normalizeAppSettings({}).hideReasoning, false);
    assert.equal(storage.normalizeAppSettings({ hideReasoning: 'yes' }).hideReasoning, false);
    assert.equal(storage.normalizeAppSettings({ hideReasoning: true, autoExpandReasoning: true }).hideReasoning, true);
    assert.equal(storage.normalizeAppSettings({ hideReasoning: true, autoExpandReasoning: true }).autoExpandReasoning, true);
    const saved = new Map();
    const deps = {
        storage: { getItem: async (key) => saved.get(key) ?? null, setItem: async (key, value) => void saved.set(key, value), removeItem: async (key) => void saved.delete(key) },
        desktop: { isElectron: () => false },
    };
    const queryClient = { getQueryData: () => undefined, setQueryData: () => undefined };
    await storage.saveAppSettings({ queryClient, updates: { hideReasoning: true }, deps });
    assert.equal(JSON.parse(saved.get(storage.APP_SETTINGS_KEY)).hideReasoning, true);
    assert.equal((await storage.loadAppSettingsFromStorage(deps)).hideReasoning, true);
});

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
        useTranslation: () => ({ t: (key) => key }),
        useAppSettings: () => ({ settings, updateSettings: (update) => updates.push(update) }),
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        SettingsSwitch: 'SettingsSwitch', SettingsCard: 'SettingsCard', SettingsSection: 'SettingsSection', SettingsSelect: 'SettingsSelect',
        View: 'View', isNative: false,
    };
    const { ChatSection } = loadModule(patched, 'e.ChatSection=function', stub);
    const card = () => ChatSection().props.children.props.children;
    const labels = (node) => node.props.children.map((child) => [child.type, child.props.label, child.props.value]);
    assert.deepEqual(labels(card()), [
        ['SettingsSwitch', 'settings.general.autoExpandReasoning.label', false],
        ['SettingsSwitch', 'settings.general.hideReasoning.label', false],
        ['SettingsSelect', 'settings.general.toolCallDetail.label', 'detailed'],
        ['SettingsSwitch', 'settings.appearance.chatOutline.title', true],
    ]);
    card().props.children[1].props.onValueChange(true);
    assert.deepEqual(updates, [{ hideReasoning: true }]);
    settings = { ...settings, hideReasoning: true };
    assert.equal(card().props.children[1].props.value, true);
    assert.equal(card().props.children[1].props.hint, 'settings.general.hideReasoning.description');
});

test('web locale strings match the shared Android resources for every language', () => {
    const files = ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN'];
    const strings = files.map((name) => {
        const text = readFileSync(new URL(`${name}.ts`, androidResources), 'utf8');
        const block = /hideReasoning: \{\s*label: "([^"]+)",\s*description:\s*"([^"]+)",\s*\}/.exec(text);
        return [block[1], block[2]];
    });
    for (const [label, description] of strings) {
        const locale = loadModule(patched, `hideReasoning:{label:"${label.replace(/[^\x00-\x7e]/g, (character) => {
            const code = character.codePointAt(0);
            return code <= 0xff ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0');
        })}"`);
        const resource = Object.values(locale).find((value) => value?.settings?.general?.hideReasoning);
        assert.deepEqual(resource.settings.general.hideReasoning, { label, description });
    }
});

test('chat view reads the setting and invalidates the presentation memo with it', () => {
    assert.ok(patched.includes('const n=(0,c.c)(247),'));
    assert.ok(patched.includes('pdHideReasoning=(0,F.useSettings)(e=>!0===e.hideReasoning)'));
    assert.ok(patched.includes('n[246]!==pdHideReasoning?(Qt=$t({tail:Vt,head:Jt,transform:nt,level:Fe,isTurnActive:Nt,hideReasoning:pdHideReasoning})'));
    assert.equal(current.includes('hideReasoning'), false);
});

test('reviewed desktop bundle carries the same hide reasoning patch', { skip: !existsSync(DESKTOP_COMPOSER_FILE) }, () => {
    const desktop = patchedComposerSource(readFileSync(DESKTOP_COMPOSER_FILE, 'utf8'));
    assert.equal(withHideReasoning(withoutHideReasoning(desktop)), desktop);
});
