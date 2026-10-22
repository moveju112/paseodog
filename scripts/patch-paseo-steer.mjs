import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import { agentMessageTransportEdits } from '../patches/paseo-agent-messages.mjs';
import { ADAPTER_PHASE_EDITS, withAssistantPhase, withoutAssistantPhase } from '../patches/paseo-assistant-phase.mjs';
import { REVERT_HISTORY_EDIT } from '../patches/paseo-revert-history.mjs';

// PaseoDog의 미지원 지시는 대기열 사용을 안내하고 암묵적인 턴 교체를 막는다.
// 같은 어댑터 파일의 대화 되돌리기 기록 절단도 이 검토 원본 위에 함께 적용한다.
export function patchedSteerSource(source) {
    const phaseBase = withoutAssistantPhase(source, ADAPTER_PHASE_EDITS);
    const hadPhase = phaseBase !== source;
    source = phaseBase;
    let transportOriginal = source;
    for (const [before, after] of [...agentMessageTransportEdits].reverse())
        transportOriginal = transportOriginal.replace(after, before);
    const before = '    async steerActiveTurn(prompt, options) {\n';
    const previous = before + '        if (!this.bridge.negotiatedCapabilities.includes("prompt.steer")) return { status: "unavailable" };\n';
    const after = before + '        if (!this.bridge.negotiatedCapabilities.includes("prompt.steer")) {\n            if (this.provider === "paseodog") throw new Error("PaseoDog cannot steer an active turn. Queue this message instead; the active turn was not interrupted.");\n            return { status: "unavailable" };\n        }\n';
    const failureBefore = '        return result.type === "steer" && result.turnId === options.expectedTurnId';
    const failureAfter = '        if (result.type === "failed") throw providerError(result.error);\n' + failureBefore;
    const [revertBefore, revertAfter] = REVERT_HISTORY_EDIT;
    const original = transportOriginal.replace(revertAfter, revertBefore)
        .replace(failureAfter, failureBefore).replace(after, before).replace(previous, before);
    if (gitBlob(original) !== '8516d2ea7d46b1af26b669ab2e80f2befd28f77c')
        throw new Error('Paseo steering source hash mismatch');
    if (original.split(revertBefore).length !== 2) throw new Error('Paseo revert history anchor mismatch');
    let result = original.replace(before, after).replace(failureBefore, failureAfter).replace(revertBefore, revertAfter);
    if (transportOriginal !== source) {
        for (const [before, after] of agentMessageTransportEdits) result = result.replace(before, after);
        // 되돌리기 기록 절단이 없는 이전 설치본도 같은 전송 패치로 인정해 갱신한다.
        if (result.replace(revertAfter, revertBefore) !== source.replace(revertAfter, revertBefore))
            throw new Error('Partial Paseo agent-message transport patch');
    }
    return hadPhase ? withAssistantPhase(result, ADAPTER_PHASE_EDITS) : result;
}

// 미지원 지시는 활성 턴을 교체하지 못하게 차단하고 검토한 설치본에만 적용한다.
export function patchPaseoSteer(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== '0.11.4') throw new Error('Paseo 0.11.4 required');
    const path = resolve(root, 'dist/server/server/agent/plugin-provider.js');
    const source = readFileSync(path, 'utf8');
    const result = patchedSteerSource(source);
    if (check && result !== source) throw new Error('Paseo steering patch is missing');
    if (!check && result !== source) writeFileSync(path, result);
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    patchPaseoSteer(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), {
        check: process.argv.includes('--check'),
    });
}
