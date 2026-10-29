import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { gitBlob } from '../scripts/patch-mixdog.mjs';

export const RELAY_RECONNECT_BLOB = 'c62d87c8aceb54b51de8c74a01226a30de1af209';

// 소스와 설치본이 같은 연결 수명주기를 사용하며 검토하지 않은 입력은 거부한다.
export function patchedRelayReconnectSource(source) {
    const replacement = stripTypeScriptTypes(readFileSync(
        new URL('../android/packages/server/src/server/relay-transport.ts', import.meta.url), 'utf8'));
    if (source !== replacement && gitBlob(source) !== RELAY_RECONNECT_BLOB)
        throw new Error('Paseo relay reconnect source hash mismatch');
    return replacement;
}
