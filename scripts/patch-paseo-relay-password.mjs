// 버전·원본 blob을 확인한 0.11.4 데몬·CLI·SDK에 릴레이 암호 인증을 적용한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'android/packages');
export const RELAY_PASSWORD_PATCHES = [
    { package: 'server', file: 'dist/server/server/session-admission-auth.js',
        blob: '95030cbe6f06c782953a68d5db06c53d8ca3b5c5', source: 'server/src/server/session-admission-auth.ts' },
    { package: 'server', file: 'dist/server/server/pairing-offer.js',
        blob: '3c6d163a523a6b0403980557c7b5456e3f83427a', source: 'server/src/server/pairing-offer.ts' },
    { package: 'cli', file: 'dist/commands/daemon/pair.js',
        blob: '7e31fd5d38bfac62fb97cd63f9c868726652b726', source: 'cli/src/commands/daemon/pair.ts' },
    { package: 'server', file: 'dist/server/server/session/daemon/daemon-session.js',
        blob: 'ea9a4e9c241749a4c5b198a9c83110a7e2f52aa7', edits: [[
            '                relayEnabled: relay?.enabled ?? false,\n',
            '                relayEnabled: relay?.enabled ?? false,\n                password: msg.password,\n',
        ]] },
    { package: 'server', file: 'dist/server/server/websocket-server.js',
        blob: 'd2faa2c4fbddfe3264a604a36e5b09802386d69c', edits: [[
            'import { resolveSessionAdmission } from "./session-admission-auth.js";',
            'import { resolveSessionAdmission } from "./session-admission-auth.js";\nimport { readRelayPasswordHash } from "./relay-password.js";',
        ], [
            '                passwordHash: this.passwordHash,\n',
            '                passwordHash: this.passwordHash,\n                relayPasswordHash: pending.identity.transport === "relay" ? readRelayPasswordHash(this.paseoHome) : undefined,\n',
        ], [
            '                daemonConfigReload: true,\n',
            '                daemonConfigReload: true,\n                relayPasswordAuth: true,\n',
        ]] },
    { package: 'protocol', file: 'dist/messages.js',
        blob: '7bd464871d7543be7cb4d352511bb62bd3a1d5a2', edits: [[
            '    type: z.literal("daemon.get_pairing_offer.request"),\n    requestId: z.string(),',
            '    type: z.literal("daemon.get_pairing_offer.request"),\n    requestId: z.string(),\n    password: z.string().min(1).max(72).optional(),',
        ], [
            '        daemonStatusRpc: z.boolean().optional(),',
            '        daemonStatusRpc: z.boolean().optional(),\n        relayPasswordAuth: z.boolean().optional(),',
        ]] },
    { package: 'client', file: 'dist/daemon-client.js',
        blob: 'bbec9f5e4cad7d6f8a809c8e7222e93b8f900e3c', edits: [[
            '                type: "daemon.get_pairing_offer.request",',
            '                type: "daemon.get_pairing_offer.request",\n                ...(options?.password !== undefined ? { password: options.password } : {}),',
        ]] },
];

// 작은 인증 모듈은 공유 TypeScript 원본에서 타입만 제거해 동일한 동작으로 배포한다.
export function relayPasswordModule() {
    return stripTypeScriptTypes(readFileSync(resolve(sourceRoot, 'server/src/server/relay-password.ts'), 'utf8'));
}

// 원본 또는 완성본만 허용하고 다른 버전·부분 적용·임의 변경을 거부한다.
export function patchedRelayPasswordSource(source, spec) {
    if (spec.source) {
        const result = stripTypeScriptTypes(readFileSync(resolve(sourceRoot, spec.source), 'utf8'));
        if (source !== result && gitBlob(source) !== spec.blob) throw new Error(`Paseo relay password hash mismatch: ${spec.file}`);
        return result;
    }
    let original = source;
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, () => before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo relay password hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Paseo relay password anchor mismatch: ${spec.file}`);
        result = result.replace(before, () => after);
    }
    if (source !== original && source !== result) throw new Error(`Partial Paseo relay password patch: ${spec.file}`);
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
    if (before !== undefined && before !== after) throw new Error('Paseo relay password helper drift');
    changes.push({ path: helperPath, before, after });
    if (check && changes.some((file) => file.before !== file.after)) throw new Error('Paseo relay password patch is missing');
    for (const file of changes) if (!check && file.before !== file.after) writeFileSync(file.path, file.after);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { patchPaseoRelayPassword(undefined, { check: process.argv.includes('--check') }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
