// 버전·원본 blob을 확인한 0.11.4 데몬·CLI·SDK에 릴레이 암호 인증을 적용한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'android/packages');
export const RELAY_PASSWORD_PATCHES = [
    // previous: 이전에 배포한 PaseoDog 결과물 blob. 검토된 업그레이드 경로로만 허용한다.
    { package: 'server', file: 'dist/server/server/session-admission-auth.js',
        blob: '95030cbe6f06c782953a68d5db06c53d8ca3b5c5', source: 'server/src/server/session-admission-auth.ts',
        previous: ['ad35d4a821a7862b783f8c253ec3288dc39aa2d7', 'c1bb96fef533338148778fc69c9c95cf2d0b3267'] },
    { package: 'server', file: 'dist/server/server/pairing-offer.js',
        blob: '3c6d163a523a6b0403980557c7b5456e3f83427a', source: 'server/src/server/pairing-offer.ts',
        previous: ['5c125a60944c228e98c2ea93d08bf9e9716219a4', '8fefab2893f5c4f0c160dde00d1b2589f4c667ce',
            '4e185952772281983aefac83838e606a2312fec0'] },
    { package: 'cli', file: 'dist/commands/daemon/pair.js',
        blob: '7e31fd5d38bfac62fb97cd63f9c868726652b726', source: 'cli/src/commands/daemon/pair.ts',
        previous: ['1de64ad714077bef1e1498ff73750664072cb390'] },
    // legacyEditCounts: 이전 배포본이 적용한 앞쪽 편집 개수. 그 상태에서만 나머지 편집을 이어 붙인다.
    { package: 'server', file: 'dist/server/server/session/daemon/daemon-session.js',
        blob: 'ea9a4e9c241749a4c5b198a9c83110a7e2f52aa7', legacyEditCounts: [1], edits: [[
            '                relayEnabled: relay?.enabled ?? false,\n',
            '                relayEnabled: relay?.enabled ?? false,\n                password: msg.password,\n',
        ], [
            '                password: msg.password,\n',
            '                password: msg.password,\n                reset: msg.reset === true,\n',
        ], [
            '                    relayEnabled: pairing.relayEnabled,\n                },\n            });\n        }\n        catch (error) {\n            this.logger.error({ err: error }, "Failed to handle daemon pairing offer request");\n',
            '                    relayEnabled: pairing.relayEnabled,\n                },\n            });\n'
                + '            // 재설정한 키는 릴레이 연결에 재시작 후 적용되며 기존 릴레이 세션도 끊는다.\n'
                + '            if (msg.reset === true && pairing.url) {\n'
                + '                this.host.emitLifecycleIntent({ type: "restart", clientId: this.clientId, requestId: msg.requestId, reason: "relay_access_reset" });\n'
                + '            }\n'
                + '        }\n        catch (error) {\n            this.logger.error({ err: error }, "Failed to handle daemon pairing offer request");\n',
        ]] },
    { package: 'server', file: 'dist/server/server/websocket-server.js',
        blob: 'd2faa2c4fbddfe3264a604a36e5b09802386d69c', legacyEditCounts: [3], edits: [[
            'import { resolveSessionAdmission } from "./session-admission-auth.js";',
            'import { resolveSessionAdmission } from "./session-admission-auth.js";\nimport { readRelayPasswordHash } from "./relay-password.js";',
        ], [
            '                passwordHash: this.passwordHash,\n',
            '                passwordHash: this.passwordHash,\n                relayPasswordHash: pending.identity.transport === "relay" ? readRelayPasswordHash(this.paseoHome) : undefined,\n',
        ], [
            '                daemonConfigReload: true,\n',
            '                daemonConfigReload: true,\n                relayPasswordAuth: true,\n',
        ], [
            '                relayPasswordHash: pending.identity.transport === "relay" ? readRelayPasswordHash(this.paseoHome) : undefined,\n',
            '                relayPasswordHash: pending.identity.transport === "relay" ? readRelayPasswordHash(this.paseoHome) : undefined,\n                paseoHome: this.paseoHome,\n',
        ]] },
    { package: 'protocol', file: 'dist/messages.js',
        blob: '7bd464871d7543be7cb4d352511bb62bd3a1d5a2', legacyEditCounts: [2], edits: [[
            '    type: z.literal("daemon.get_pairing_offer.request"),\n    requestId: z.string(),',
            '    type: z.literal("daemon.get_pairing_offer.request"),\n    requestId: z.string(),\n    password: z.string().min(1).max(72).optional(),',
        ], [
            '        daemonStatusRpc: z.boolean().optional(),',
            '        daemonStatusRpc: z.boolean().optional(),\n        relayPasswordAuth: z.boolean().optional(),',
        ], [
            '    password: z.string().min(1).max(72).optional(),',
            '    password: z.string().min(1).max(72).optional(),\n    reset: z.boolean().optional(),',
        ]] },
    { package: 'client', file: 'dist/daemon-client.js',
        blob: 'bbec9f5e4cad7d6f8a809c8e7222e93b8f900e3c', legacyEditCounts: [1], edits: [[
            '                type: "daemon.get_pairing_offer.request",',
            '                type: "daemon.get_pairing_offer.request",\n                ...(options?.password !== undefined ? { password: options.password } : {}),',
        ], [
            '                ...(options?.password !== undefined ? { password: options.password } : {}),',
            '                ...(options?.password !== undefined ? { password: options.password } : {}),\n                ...(options?.reset ? { reset: true } : {}),',
        ]] },
];

// 작은 인증 모듈은 공유 TypeScript 원본에서 타입만 제거해 동일한 동작으로 배포한다.
export function relayPasswordModule() {
    return stripTypeScriptTypes(readFileSync(resolve(sourceRoot, 'server/src/server/relay-password.ts'), 'utf8'));
}

export function withoutRelayPasswordEdits(source, edits) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

// 원본 또는 완성본만 허용하고 다른 버전·부분 적용·임의 변경을 거부한다.
export function patchedRelayPasswordSource(source, spec) {
    if (spec.source) {
        const result = stripTypeScriptTypes(readFileSync(resolve(sourceRoot, spec.source), 'utf8'));
        if (source !== result && gitBlob(source) !== spec.blob && !spec.previous?.includes(gitBlob(source)))
            throw new Error(`Paseo relay password hash mismatch: ${spec.file}`);
        return result;
    }
    const original = withoutRelayPasswordEdits(source, spec.edits);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo relay password hash mismatch: ${spec.file}`);
    let result = original;
    const legacyResults = [];
    for (const [index, [before, after]] of spec.edits.entries()) {
        if (spec.legacyEditCounts?.includes(index)) legacyResults.push(result);
        if (result.split(before).length !== 2) throw new Error(`Paseo relay password anchor mismatch: ${spec.file}`);
        result = result.replace(before, () => after);
    }
    if (source !== original && source !== result && !legacyResults.includes(source))
        throw new Error(`Partial Paseo relay password patch: ${spec.file}`);
    return result;
}

// 모든 파일을 먼저 검증하고 원본이 확인된 설치본에만 패치를 쓴다.
export function patchPaseoRelayPassword(base = resolve(root, 'tools/node_modules/@getpaseo'), { check = false } = {}) {
    const changes = RELAY_PASSWORD_PATCHES.map((spec) => {
        const packageRoot = resolve(base, spec.package);
        if (JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version !== '0.11.4')
            throw new Error('Paseo relay password requires 0.11.4');
        const path = resolve(packageRoot, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedRelayPasswordSource(before, spec) };
    });
    const helperPath = resolve(base, 'server/dist/server/server/relay-password.js');
    const before = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : undefined;
    const after = relayPasswordModule();
    // 이전 PaseoDog 헬퍼 결과물만 교체를 허용하고 그 밖의 변경은 거부한다.
    if (before !== undefined && before !== after && !['9021b6d4d426481e6ca13efdd0dc56721079299e', 'd83f134f54c11153d3f462c6eb952564751e925d', '7e45d9ff60a902001755779df3bde4e2d33d9168'].includes(gitBlob(before)))
        throw new Error('Paseo relay password helper drift');
    changes.push({ path: helperPath, before, after });
    if (check && changes.some((file) => file.before !== file.after)) throw new Error('Paseo relay password patch is missing');
    for (const file of changes) if (!check && file.before !== file.after) writeFileSync(file.path, file.after);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { patchPaseoRelayPassword(undefined, { check: process.argv.includes('--check') }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
