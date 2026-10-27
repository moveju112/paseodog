import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { DEFAULT_TURN_MINUTES, MAX_TURN_MINUTES } from '../plugin/shared/turn-duration.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = stripTypeScriptTypes(read('android/packages/app/src/screens/settings/turn-duration-settings.ts'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const components = { View: 'view', Text: 'text', AdaptiveTextInput: 'input', Pressable: 'pressable' };

// 서버 웹과 앱은 같은 컴포넌트를 빌드한다. 사라진 번들 복사본 대신 실제 공유 구현에
// 입력 검증·중복 저장 방지·불확실한 응답·호스트 전환의 기존 시나리오를 모두 적용한다.
    test('shared app/server web workflow duration saves minutes safely and isolates hosts', async t => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        t.after(() => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
        let connected = true, fail = false, malformed = false, deferred, finish;
        const values = { one: DEFAULT_TURN_MINUTES, two: 240 };
        const calls = [];
        const clients = Object.fromEntries(Object.keys(values).map(host => [host, {
            async invokePluginRpc(plugin, method, input) {
                assert.equal(plugin, 'paseodog-provider');
                assert.equal(method, 'engine-controls');
                calls.push({ host, ...input });
                if (deferred === host) return new Promise(resolve => { finish = resolve; });
                if (fail) throw new Error('uncertain response');
                if (malformed) return {};
                if (input.action === 'turnDuration') values[host] = input.maxTurnMinutes;
                return { maxTurnMinutes: values[host] };
            },
        }]));
        const runtime = {
            useHostRuntimeClient: id => clients[id],
            useHostRuntimeIsConnected: () => connected,
        };
        const common = { ...React, ...components, ...runtime, settingsStyles: {} };
        const Component = runInNewContext(source + ';TurnDurationSettings', common);
        let Page;
        {
            const page = read('android/packages/app/src/screens/settings/ai-engine-page.tsx');
            const body = page.slice(page.indexOf('export function AiEnginePage(')).replace('export function', 'function');
            const compiled = ts.transpileModule(body, {
                compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
            }).outputText;
            Page = runInNewContext(compiled + ';AiEnginePage', {
                ...common, React, TurnDurationSettings: Component, AgentMessageSettings: () => null,
                useAiEngineSettings: () => ({ snapshot: null, connected: true, request() {} }),
                layout: {}, Button: 'button',
            });
        }
        let tree;
        await act(async () => { tree = create(React.createElement(Page, { serverId: 'one', section: 'tokens' })); });
        const field = () => tree.root.findByProps({ accessibilityLabel: '명령 최대 실행 시간 (분)' });
        const save = () => tree.root.findByProps({ accessibilityLabel: '실행 시간 저장' });
        const refresh = () => tree.root.findByProps({ accessibilityLabel: '실행 시간 설정 새로고침' });
        const update = async (serverId = 'one', section = 'workflow') =>
            act(async () => tree.update(React.createElement(Page, { serverId, section })));
        assert.equal(tree.root.findAllByType('input').length, 0);
        assert.equal(calls.length, 0);
        await update();
        assert.equal(field().props.initialValue, String(DEFAULT_TURN_MINUTES));
        assert.match(JSON.stringify(tree.toJSON()), /120분 \(2시간\)/);
        for (const invalid of ['', '0', '-1', '1.5', String(MAX_TURN_MINUTES + 1), 'abc']) {
            await act(async () => field().props.onChangeText(invalid));
            assert.equal(save().props.disabled, true);
            await act(async () => save().props.onPress());
        }
        assert.equal(calls.length, 1);
        for (const valid of [1, MAX_TURN_MINUTES, 180]) {
            await act(async () => field().props.onChangeText(String(valid)));
            await act(async () => save().props.onPress());
            assert.equal(values.one, valid);
        }
        assert.match(JSON.stringify(tree.toJSON()), /저장했어요. 다음 명령부터/);
        deferred = 'one';
        await act(async () => {
            save().props.onPress();
            save().props.onPress();
        });
        assert.equal(calls.filter(call => call.action === 'turnDuration').length, 4);
        assert.equal(save().props.disabled, true);
        assert.equal(field().props.editable, false);
        deferred = undefined;
        await act(async () => finish({ maxTurnMinutes: 180 }));
        fail = true;
        await act(async () => field().props.onChangeText('300'));
        await act(async () => save().props.onPress());
        const count = calls.length;
        assert.equal(values.one, 180);
        assert.equal(save().props.disabled, true);
        assert.match(JSON.stringify(tree.toJSON()), /자동 재전송하지/);
        await act(async () => save().props.onPress());
        assert.equal(calls.length, count);
        fail = false;
        await act(async () => refresh().props.onPress());
        assert.equal(field().props.initialValue, '180');
        malformed = true;
        await act(async () => refresh().props.onPress());
        assert.equal(save().props.disabled, true);
        malformed = false;
        deferred = 'one';
        await act(async () => refresh().props.onPress());
        await update('two');
        assert.equal(field().props.initialValue, '240');
        await act(async () => finish({ maxTurnMinutes: 999 }));
        assert.equal(field().props.initialValue, '240');
        connected = false;
        await update('two');
        assert.equal(save().props.disabled, true);
        const disconnectedCalls = calls.length;
        await act(async () => save().props.onPress());
        assert.equal(calls.length, disconnectedCalls);
        connected = true;
        await update('two');
        assert.equal(save().props.disabled, false);
        assert.equal(field().props.initialValue, '240');
        await act(async () => tree.unmount());
    });
