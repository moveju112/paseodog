// 로컬 Apache-2.0 패치: Paseo 0.11.4 선택 본문 단계의 전송·이력 투영을 보존한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';
import { PROVIDER_PHASE_EDITS, MESSAGES_PHASE_EDITS, ADAPTER_PHASE_EDITS, PROJECTION_PHASE_EDITS,
    withAssistantPhase, withoutAssistantPhase, normalizeAssistantPhase } from '../patches/paseo-assistant-phase.mjs';
import { RELAY_PASSWORD_PATCHES, withoutRelayPasswordEdits, patchedRelayPasswordSource } from './patch-paseo-relay-password.mjs';

const relayProtocol = RELAY_PASSWORD_PATCHES.find(spec => spec.package === 'protocol');

export const ASSISTANT_PHASE_PATCHES = [
    { root: 'tools/node_modules/@getpaseo/plugin', file: 'dist/server/provider.js', blob: '011490f3eebf9c15c985474c07b52beda5ca697c', edits: PROVIDER_PHASE_EDITS },
    { root: 'plugin/node_modules/@getpaseo/plugin', file: 'dist/server/provider.js', blob: '011490f3eebf9c15c985474c07b52beda5ca697c', edits: PROVIDER_PHASE_EDITS },
    { root: 'tools/node_modules/@getpaseo/protocol', file: 'dist/messages.js', blob: '33893c7e2598b8194cb9926d98f0084792c1e158', edits: MESSAGES_PHASE_EDITS },
    { root: 'plugin/node_modules/@getpaseo/protocol', file: 'dist/messages.js', blob: '33893c7e2598b8194cb9926d98f0084792c1e158', edits: MESSAGES_PHASE_EDITS },
    { root: 'tools/node_modules/@getpaseo/server', file: 'dist/server/server/agent/plugin-provider.js', blob: '377a7cadccd3e2413f601417d5ee1d69e012f485', edits: ADAPTER_PHASE_EDITS },
    { root: 'tools/node_modules/@getpaseo/server', file: 'dist/server/server/agent/timeline-projection.js', blob: 'c04cdf08abf75c90cb46f303a76b310c91fab634', edits: PROJECTION_PHASE_EDITS },
];

// 완성된 패치만 정규화해 정확한 검토 blob을 검사한다.
export function patchedAssistantPhaseSource(source, spec) {
    source = normalizeAssistantPhase(source);
    const original = withoutAssistantPhase(source, spec.edits);
    // 뒤에 적용되는 릴레이 필드는 검토 blob 비교에서만 해제하고 결과에는 그대로 보존한다.
    const protocol = spec.file === relayProtocol.file;
    const reviewed = protocol ? withoutRelayPasswordEdits(original, relayProtocol.edits) : original;
    if (gitBlob(reviewed) !== spec.blob) throw new Error(`Paseo assistant phase source hash mismatch: ${spec.file}`);
    const result = withAssistantPhase(original, spec.edits);
    if (source !== original && source !== result) throw new Error(`Partial Paseo assistant phase patch: ${spec.file}`);
    // 릴레이 원본·완성본·기존 지원본만 허용한다. 부분 적용을 정규화로 숨기지 않는다.
    if (protocol) patchedRelayPasswordSource(result, relayProtocol);
    return result;
}

// 모든 SDK·프로토콜·어댑터를 검사한 뒤에만 함께 적용한다.
export function patchPaseoAssistantPhase(projectRoot, { check = false } = {}) {
    const changes = ASSISTANT_PHASE_PATCHES.map((spec) => {
        const root = resolve(projectRoot, spec.root);
        if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
            throw new Error('Paseo assistant phase requires 0.11.4');
        const path = resolve(root, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedAssistantPhaseSource(before, spec) };
    });
    if (check && changes.some(({ before, after }) => before !== after)) throw new Error('Paseo assistant phase patch is missing');
    for (const { path, before, after } of changes) if (!check && before !== after) writeFileSync(path, after);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self)
    patchPaseoAssistantPhase(resolve(dirname(self), '..'), { check: process.argv.includes('--check') });
