import { randomUUID } from 'node:crypto';

const OAUTH_PROVIDERS = ['anthropic-oauth', 'openai-oauth'];
const API_KEY_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'deepseek', 'xai', 'groq', 'mistral'];

// OAuth 계정 풀과 선택 상태를 민감 토큰 없이 UI 표시용 구조로 정규화한다.
async function readOAuthStatus(runtime, provider, flow) {
    const pool = await runtime.getProviderAccounts(provider);
    const accounts = (pool?.accounts || []).map((acc) => ({
        id: String(acc.id || ''),
        label: String(acc.label || acc.email || acc.id || ''),
        email: typeof acc.email === 'string' ? acc.email : '',
        plan: typeof acc.plan === 'string' ? acc.plan : '',
        authenticated: acc.authenticated === true,
        selected: acc.selected === true || acc.id === pool?.selectedId,
        usage: acc.usage && typeof acc.usage === 'object' ? acc.usage : null,
    }));
    const apiProviders = typeof runtime.getProviderSetup === 'function'
        ? ((await runtime.getProviderSetup())?.api || []).map((p) => ({
            id: String(p.id || ''),
            label: String(p.label || p.name || p.id || ''),
            configured: p.configured === true || p.authenticated === true || p.hasKey === true,
        }))
        : [];
    return {
        connected: accounts.some((account) => account.authenticated === true),
        state: flow?.provider === provider ? flow.state : 'idle',
        selectedId: pool?.selectedId || null,
        accounts,
        apiProviders,
    };
}

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
            if (input.action === 'saveApiKey') {
                if (!API_KEY_PROVIDERS.includes(input.provider)) throw new Error('Unsupported API key provider');
                const trimmed = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
                if (!trimmed) {
                    await runtime.forgetProviderAuth?.(input.provider);
                } else {
                    if (typeof runtime.saveProviderApiKey !== 'function') throw new Error('API key save not supported');
                    await runtime.saveProviderApiKey(input.provider, trimmed);
                }
                const setup = typeof runtime.getProviderSetup === 'function' ? await runtime.getProviderSetup() : null;
                return {
                    state: 'completed',
                    connected: Boolean(trimmed),
                    apiProviders: (setup?.api || []).map((p) => ({
                        id: String(p.id || ''),
                        label: String(p.label || p.name || p.id || ''),
                        configured: p.configured === true || p.authenticated === true || p.hasKey === true,
                    })),
                };
            }
            if (!OAUTH_PROVIDERS.includes(input.provider)) throw new Error('Unsupported account provider');
            if (input.action === 'status') {
                return await readOAuthStatus(runtime, input.provider, flow);
            }
            if (input.action === 'selectAccount') {
                if (typeof input.accountId !== 'string' || !input.accountId.trim()) throw new Error('accountId required');
                if (typeof runtime.updateProviderAccounts !== 'function') throw new Error('Account selection not supported');
                await runtime.updateProviderAccounts(input.provider, { selectedId: input.accountId.trim() });
                return await readOAuthStatus(runtime, input.provider, flow);
            }
            if (input.action === 'refreshUsage') {
                if (typeof runtime.updateProviderAccounts !== 'function') throw new Error('Usage refresh not supported');
                await runtime.updateProviderAccounts(input.provider, { refreshUsage: true });
                return await readOAuthStatus(runtime, input.provider, flow);
            }
            if (input.action === 'logout') {
                if (typeof runtime.forgetProviderAuth !== 'function') throw new Error('Logout not supported');
                await runtime.forgetProviderAuth(input.provider, input.accountId ? String(input.accountId).trim() : undefined);
                return await readOAuthStatus(runtime, input.provider, flow);
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
