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
