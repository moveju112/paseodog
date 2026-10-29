import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalRoot, paseoHome } from './paths.mjs';
import { deliveryReportPrompt, readDeliveryReport } from '../plugin/server/delivery-notifications.mjs';

async function connectReportClient(options) {
    const { connectToDaemon } = await import('../tools/node_modules/@getpaseo/cli/dist/utils/client.js');
    return connectToDaemon(options);
}

// 기존 전용 CLI의 인증·연결 경로와 서버의 영속 messageId receipt를 그대로 사용한다.
export async function sendDeliveryReport(id, { stateRoot = journalRoot, home = paseoHome,
    connect = connectReportClient } = {}) {
    const report = await readDeliveryReport(stateRoot, id);
    if (!report?.result) throw new Error('Delivery report has no terminal result');
    const client = await connect({ target: { kind: 'instance', home } });
    try {
        const snapshot = await client.fetchAgent({ agentId: report.agentId });
        const agent = snapshot?.agent;
        if (!agent || agent.archivedAt || agent.provider !== 'paseodog'
            || !['idle', 'error'].includes(agent.status) || agent.pendingPermissions?.length) return false;
        await client.sendAgentMessage(report.agentId, deliveryReportPrompt(report), {
            messageId: report.eventId, activeTurnBehavior: 'steer',
        });
        return true;
    } finally { await client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: { id: { type: 'string' } } });
        if (!await sendDeliveryReport(values.id)) process.exitCode = 3;
    } catch (error) {
        process.exitCode = error.message === 'agent_request_outcome_unknown' ? 2 : 1;
        console.error('Delivery report was not confirmed; its durable request was retained');
    }
}
