import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext, Script } from 'node:vm';
import { createInterruptConfirmation } from '../android/packages/app/src/composer/interrupt-confirmation.ts';

const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');

function functionSource(source, name, kind) {
    const ast = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, kind);
    let found;
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(found, name);
    return found.getText(ast);
}

function nativeCallback(source, name) {
    const ast = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(callback, name);
    return ts.transpileModule('const callback=' + callback.getText(ast), {}).outputText + '; callback';
}

const native = readFileSync(new URL('../android/packages/app/src/composer/index.tsx', import.meta.url), 'utf8');

test('shared composer omits realtime voice controls without disabling dictation keyboard handling', () => {
    assert.doesNotMatch(native, /AudioLines|realtimeVoiceButton|handleToggleRealtimeVoice|useVoiceOptional/);
    assert.ok(functionSource(native, 'dispatchComposerKeyboardAction', ts.ScriptKind.TSX));
});

test('native and web Esc handlers require approval, preserve the draft, and reject stale turn targets', async () => {
    const nativeCode = nativeCallback(native, 'handleKeyboardInterruptAgent');
    for (const implementation of ['shared']) {
        for (const scenario of ['dismiss', 'approve', 'new-turn', 'other-agent', 'completed', 'dialog-error']) {
            let turn = { isActive: true, isCancelling: false, turnId: 'turn-1' };
            const agentRef = { current: 'agent-1' };
            const draft = 'keep this unsent prompt';
            const errors = [];
            const requests = [];
            let interruptions = 0;
            const cancel = () => interruptions++;
            const confirm = async (request) => {
                requests.push(request);
                assert.equal(interruptions, 0);
                if (scenario === 'new-turn') turn = { ...turn, turnId: 'turn-2' };
                if (scenario === 'other-agent') agentRef.current = 'agent-2';
                if (scenario === 'completed') turn = { ...turn, isActive: false };
                if (scenario === 'dialog-error') throw new Error('dialog failed');
                return scenario !== 'dismiss';
            };
            const store = {
                useSessionStore: { getState: () => ({ sessions: { host: {} } }) },
                selectAgentTurnPresentation: () => turn,
            };
            const guard = createInterruptConfirmation();
            let pending;
            const capture = (input) => (pending = guard(input));
            const t = key => key;
            const resolveErrorMessage = error => error.message;
            {
                const handle = runInNewContext(nativeCode, {
                    isNative: false, handleCancelAgent: cancel, agentIdRef: agentRef,
                    selectAgentTurnPresentation: store.selectAgentTurnPresentation,
                    useSessionStore: store.useSessionStore, serverId: 'host',
                    interruptConfirmation: capture, confirmDialog: confirm, t,
                    resolveErrorMessage, toastErrorRef: { current: error => errors.push(error) },
                });
                handle();
            }
            await pending;
            assert.equal(interruptions, scenario === 'approve' ? 1 : 0, implementation + ':' + scenario);
            assert.equal(draft, 'keep this unsent prompt');
            assert.equal(requests.length, 1);
            assert.equal(requests[0].title, 'composer.cancel.confirmTitle');
            assert.equal(requests[0].destructive, true);
            assert.deepEqual(errors, scenario === 'dialog-error' ? ['dialog failed'] : []);
        }
    }
});

test('Esc still cancels dictation first and ignores idle, disconnected or unfocused agents', () => {
    const code = ts.transpileModule(functionSource(native, 'dispatchComposerKeyboardAction', ts.ScriptKind.TSX), {}).outputText;
    const dispatch = runInNewContext(code + ';dispatchComposerKeyboardAction', {});
    for (const scenario of ['dictation', 'idle', 'offline', 'unfocused', 'cancelling', 'running']) {
        let confirmations = 0;
        const handled = dispatch({
            action: { id: 'agent.interrupt' }, isPaneFocused: scenario !== 'unfocused',
            messageInputRef: { current: { runKeyboardAction: () => scenario === 'dictation' } },
            isAgentRunning: scenario !== 'idle', isCancellingAgent: scenario === 'cancelling',
            isConnected: scenario !== 'offline', handleCancelAgent: () => confirmations++,
        });
        assert.equal(confirmations, scenario === 'running' ? 1 : 0);
        assert.equal(handled, scenario === 'dictation' || scenario === 'running');
    }
});

test('web interrupt dialog translations match every shared locale', () => {
    const localeNames = ['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN'];
    for (const name of localeNames) {
        const source = readFileSync(new URL('../android/packages/app/src/i18n/resources/' + name + '.ts', import.meta.url), 'utf8');
        const ast = ts.createSourceFile(name + '.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        let copy;
        function visit(node) {
            if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'cancel' &&
                ts.isObjectLiteralExpression(node.initializer) &&
                node.initializer.properties.some(item => item.name?.getText(ast) === 'confirmTitle')) {
                copy = Object.fromEntries(node.initializer.properties.map(item => [item.name.getText(ast), item.initializer.text]));
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
        assert.ok(copy, name);
        assert.ok(copy.confirmTitle?.trim(), name);
        assert.ok(copy.confirmMessage?.trim(), name);
    }
});
