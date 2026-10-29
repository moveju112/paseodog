import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paseoHome } from './paths.mjs';

export async function backgroundRequest(input, { connect, home = paseoHome } = {}) {
    const open = connect || (await import('../tools/node_modules/@getpaseo/cli/dist/utils/client.js')).connectToDaemon;
    const client = await open({ target: { kind: 'instance', home } });
    try { return await client.invokePluginRpc('paseodog-provider', 'background-results', input); }
    finally { await client.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const action = process.argv[2];
        const { values } = parseArgs({ args: process.argv.slice(3), options: {
            agent: { type: 'string' }, job: { type: 'string' }, url: { type: 'string' },
            confirmed: { type: 'boolean' },
        } });
        if (!['register', 'status', 'cancel'].includes(action)) throw new Error('Use background register|status|cancel');
        console.log(JSON.stringify(await backgroundRequest({ action, agentId: values.agent,
            ...(values.job ? { jobId: values.job } : {}), ...(values.url ? { url: values.url } : {}),
            ...(values.confirmed ? { confirmed: true } : {}) })));
    } catch { console.error('Background request failed; verify recipient, authorization and status endpoint'); process.exitCode = 1; }
}
