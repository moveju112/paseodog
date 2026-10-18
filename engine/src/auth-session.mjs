import { randomUUID } from 'node:crypto';

// OAuth 핸들은 서버 메모리에만 보관하며 자격증명은 응답에 포함하지 않는다.
export function createAuthSession(runtime, { timeoutMs = 600000 } = {}) {
    let flow = null;
    // 로그인 완료·실패 여부만 공개하고 공급자의 원본 응답은 보관하지 않는다.
    async function settle(promise, current) {
        try {
            const result = await promise;
            if (flow === current) current.state = result?.authenticated ? 'completed' : 'failed';
        } catch {
            if (flow === current) current.state = 'failed';
        }
    }
    // 취소·만료 시 OAuth 리스너와 인증 URL을 함께 제거한다.
    async function close() {
        const current = flow;
        flow = null;
        if (current) {
            clearTimeout(current.timer);
            await current.login.cancel?.();
        }
    }
    return {
        async request(input) {
            if (!['anthropic-oauth', 'openai-oauth'].includes(input.provider)) throw new Error('Unsupported account provider');
            if (input.action === 'status') {
                const accounts = await runtime.getProviderAccounts(input.provider);
                return { connected: accounts.accounts.some((account) => account.authenticated === true),
                    state: flow?.provider === input.provider ? flow.state : 'idle' };
            }
            if (input.action === 'start') {
                await close();
                const login = await runtime.beginOAuthProviderLogin(input.provider, { openBrowser: false, addAccount: true });
                const url = login.manualUrl || login.url;
                if (typeof url !== 'string' || new URL(url).protocol !== 'https:') {
                    await login.cancel?.();
                    throw new Error('Unsupported authorization URL');
                }
                const current = { id: randomUUID(), provider: input.provider, login, state: 'pending' };
                flow = current;
                current.timer = setTimeout(() => { void close(); }, timeoutMs);
                current.timer.unref?.();
                if (login.waitForCallback) void settle(login.waitForCallback, current);
                return { id: current.id, state: current.state, url,
                    userCode: login.userCode || null, acceptsCode: typeof login.completeCode === 'function' };
            }
            if (!flow || flow.id !== input.id || flow.provider !== input.provider) throw new Error('Expired login');
            if (input.action === 'cancel') { await close(); return { state: 'idle' }; }
            if (input.action === 'complete') {
                if (flow.state !== 'pending' || !flow.login.completeCode) throw new Error('Code entry unavailable');
                if (typeof input.code !== 'string' || !input.code.trim() || input.code.length > 8192) throw new Error('Invalid code');
                const current = flow;
                current.state = 'completing';
                await settle(current.login.completeCode(input.code.trim()), current);
                return { state: current.state };
            }
            throw new Error('Unsupported login operation');
        },
        close,
    };
}
