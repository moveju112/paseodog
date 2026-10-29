import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalRoot, paseoHome } from './paths.mjs';
import { readDeliveryReport } from '../plugin/server/delivery-notifications.mjs';

async function connectReportClient(options) {
    const { connectToDaemon } = await import('../tools/node_modules/@getpaseo/cli/dist/utils/client.js');
    return connectToDaemon(options);
}

// 결과 저장은 모델 호출과 분리한다. 취소·승인 철회·모델 장애 뒤에도 새 추론을 시작하지 않는다.
export async function sendDeliveryReport(id, { stateRoot = journalRoot, home = paseoHome,
    connect = connectReportClient } = {}) {
    const report = await readDeliveryReport(stateRoot, id);
    if (!report?.result) throw new Error('Delivery report has no terminal result');
    const client = await connect({ target: { kind: 'instance', home } });
    try {
        const snapshot = await client.fetchAgent({ agentId: report.agentId });
        const agent = snapshot?.agent;
        if (!agent || agent.archivedAt || agent.provider !== 'paseodog') return false;
        const saved = await client.invokePluginRpc('paseodog-provider', 'background-results', {
            action: 'delivery', agentId: report.agentId, jobId: report.id.slice(0, 12),
            eventId: report.eventId, status: report.result.status === 'complete' ? 'completed' : 'failed',
        });
        if (!saved?.journalSaved) throw new Error('Delivery result journal was not confirmed');
        return { journalSaved: true, clientReceived: null, ai: 'not-requested' };
    } finally { await client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: { id: { type: 'string' } } });
        const result = await sendDeliveryReport(values.id);
        if (!result) process.exitCode = 3;
        else console.log(JSON.stringify(result));
    } catch (error) {
        process.exitCode = error.message === 'agent_request_outcome_unknown' ? 2 : 1;
        console.error('Delivery report was not confirmed; its durable request was retained');
    }
}
