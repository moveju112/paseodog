import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSession } from '../engine/src/auth-session.mjs';

test('OAuth preserves existing accounts, never opens host browser and projects no tokens', async () => {
    let options, canceled = 0;
    const runtime = {
        getProviderAccounts: () => ({ accounts: [{ authenticated: true, token: 'private' }] }),
        beginOAuthProviderLogin: async (provider, input) => {
            options = input;
            return { url: 'https://claude.ai/oauth/authorize', token: 'private',
                completeCode: async () => ({ authenticated: true, accessToken: 'private' }),
                cancel: () => { canceled++; } };
        },
    };
    const auth = createAuthSession(runtime);
    const provider = 'anthropic-oauth';
    assert.equal((await auth.request({ provider, action: 'status' })).connected, true);
    const started = await auth.request({ provider, action: 'start' });
    assert.deepEqual(options, { openBrowser: false, addAccount: true });
    assert.doesNotMatch(JSON.stringify(started), /private/);
    await assert.rejects(auth.request({ provider, action: 'complete', id: 'stale', code: 'code' }));
    const result = await auth.request({ provider, action: 'complete', id: started.id, code: 'code' });
    assert.deepEqual(result, { state: 'completed' });
    await auth.close();
    assert.equal(canceled, 1);
});

test('unsupported providers and non-HTTPS login URLs fail closed', async () => {
    const auth = createAuthSession({
        beginOAuthProviderLogin: async () => ({ url: 'http://unsafe.invalid', cancel() {} }),
    });
    await assert.rejects(auth.request({ action: 'start', provider: 'custom' }));
    await assert.rejects(auth.request({ action: 'start', provider: 'openai-oauth' }));
    await auth.close();
});

test('headless ChatGPT device login exposes only the user code and follows polling completion', async () => {
    let finish, options, canceled = 0;
    const waitForCallback = new Promise(resolve => { finish = resolve; });
    const auth = createAuthSession({
        getProviderAccounts: () => ({ accounts: [] }),
        beginOAuthProviderLogin: async (provider, input) => {
            assert.equal(provider, 'openai-oauth');
            options = input;
            return { manualUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234',
                deviceCode: 'private-device-token', waitForCallback, cancel() { canceled++; } };
        },
    });
    try {
        const started = await auth.request({ action: 'start', provider: 'openai-oauth' });
        assert.deepEqual(options, { openBrowser: false, addAccount: true });
        assert.equal(started.url, 'https://auth.openai.com/codex/device');
        assert.equal(started.userCode, 'ABCD-1234');
        assert.equal(started.acceptsCode, false);
        assert.doesNotMatch(JSON.stringify(started), /private-device-token|deviceCode/);
        finish({ authenticated: true, accessToken: 'private-access-token' });
        await waitForCallback;
        const status = await auth.request({ action: 'status', provider: 'openai-oauth' });
        assert.equal(status.state, 'completed');
        assert.doesNotMatch(JSON.stringify(status), /private-access-token/);
    } finally { await auth.close(); }
    assert.equal(canceled, 1);
});

test('device polling failure and late completion after cancel cannot authenticate a flow', async () => {
    let finish, fail;
    const waits = [
        new Promise((resolve, reject) => { fail = reject; }),
        new Promise(resolve => { finish = resolve; }),
    ];
    const auth = createAuthSession({
        getProviderAccounts: () => ({ accounts: [] }),
        beginOAuthProviderLogin: async () => ({
            url: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234',
            waitForCallback: waits.shift(), cancel() {},
        }),
    });
    try {
        await auth.request({ action: 'start', provider: 'openai-oauth' });
        fail(new Error('device code expired'));
        await Promise.resolve();
        assert.equal((await auth.request({ action: 'status', provider: 'openai-oauth' })).state, 'failed');
        const started = await auth.request({ action: 'start', provider: 'openai-oauth' });
        await auth.request({ action: 'cancel', provider: 'openai-oauth', id: started.id });
        finish({ authenticated: true });
        await Promise.resolve();
        assert.equal((await auth.request({ action: 'status', provider: 'openai-oauth' })).state, 'idle');
    } finally { await auth.close(); }
});
