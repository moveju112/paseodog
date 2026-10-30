// 고정된 데몬에도 앱과 같은 push 송신·세션 tag 계약을 적용한다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

export const PUSH_FILE = 'dist/server/server/push/push-service.js';
export const TAG_FILE = 'dist/server/server/push/agent-notification-tag.js';
export const PUSH_BLOB = '7a3920c489b1039a736d644b4c3d6c742562cb94';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function pushNotificationSources() {
    const service = stripTypeScriptTypes(readFileSync(resolve(root,
        'android/packages/server/src/server/push/push-service.ts'), 'utf8'))
        .replace('"@getpaseo/protocol/agent-notification-tag"', '"./agent-notification-tag.js"');
    const tag = stripTypeScriptTypes(readFileSync(resolve(root,
        'android/packages/protocol/src/agent-notification-tag.ts'), 'utf8'));
    return { service, tag };
}

export function patchPushNotifications(serverRoot, { check = false } = {}) {
    if (JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Push notification patch requires Paseo 0.11.4');
    const servicePath = resolve(serverRoot, PUSH_FILE), tagPath = resolve(serverRoot, TAG_FILE);
    const current = readFileSync(servicePath, 'utf8');
    const currentTag = existsSync(tagPath) ? readFileSync(tagPath, 'utf8') : null;
    const { service, tag } = pushNotificationSources();
    if (current === service && currentTag === tag) return;
    if (gitBlob(current) !== PUSH_BLOB || currentTag !== null)
        throw new Error('Push notification source hash mismatch or partial patch');
    if (check) throw new Error('Push notification patch is missing');
    writeFileSync(tagPath, tag);
    writeFileSync(servicePath, service);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    patchPushNotifications(resolve(root, 'tools/node_modules/@getpaseo/server'), {
        check: process.argv.includes('--check'),
    });
}
