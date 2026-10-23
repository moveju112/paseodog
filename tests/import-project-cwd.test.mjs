import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { IMPORT_CWD, IMPORT_CWD_ANCHOR, SOURCE_IMPORT_CWD } from '../patches/paseo-import-cwd.mjs';
import { IMPORT_SOURCE_FILE, patchedImportSource } from '../scripts/patch-paseo-import-cwd.mjs';

const source = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const nativeSource = readFileSync(new URL('../android/' + IMPORT_SOURCE_FILE, import.meta.url), 'utf8');

// 실제 번들의 요청 구성 함수를 실행해 프로젝트별 서버 응답을 확인한다.
function loadSessionQueries(bundle) {
    const request = bundle.indexOf('fetchRecentProviderSessions(Object.assign');
    assert.notEqual(request, -1);
    const start = bundle.lastIndexOf('function D(t){', request);
    const end = bundle.indexOf('function C(s){', request);
    assert.ok(start >= 0 && end > request);
    return new Script(bundle.slice(start, end) + ';A').runInNewContext({
        c: { keepPreviousData: undefined },
    });
}

test('project import passes the selected cwd through the shared request and preserves unscoped import', async () => {
    const patched = composerFixture(source);
    assert.equal(composerFixture(patched), patched);
    new Script(patched);
    assert.equal(patched.split(IMPORT_CWD).length, 2);
    assert.equal(patched.includes(IMPORT_CWD_ANCHOR), false);
    assert.throws(() => patchedComposerSource(patched.replace(IMPORT_CWD,
        '(0,fe.useImportSession)({serverId:T,cwd:"/other"})')), /source hash mismatch/);
    const buildQueries = loadSessionQueries(patched);
    const sessions = [
        { id: 'current', cwd: '/repo/current' },
        { id: 'nested', cwd: '/repo/current/nested' },
        { id: 'other', cwd: '/repo/other' },
    ];
    for (const cwd of ['/repo/current', '/repo/other', null]) {
        const options = new Script(IMPORT_CWD).runInNewContext({
            fe: { useImportSession: (value) => value }, T: 'host', Wt: cwd,
        });
        const calls = [];
        const queries = buildQueries({
            providersToFetch: ['paseodog'], visible: true, cwd: options.cwd,
            query: '', limit: 30,
            client: {
                // 정확한 cwd 필터를 지원하는 서버 계약을 모사한다.
                async fetchRecentProviderSessions(input) {
                    calls.push(input);
                    return sessions.filter((session) => !input.cwd || session.cwd === input.cwd);
                },
            },
        });
        const rows = await queries[0].queryFn();
        assert.equal(queries[0].enabled, true);
        assert.equal(calls.length, 1);
        assert.deepEqual(Object.keys(calls[0]).sort(), cwd ? ['cwd', 'limit', 'providers'] : ['limit', 'providers']);
        assert.equal(calls[0].cwd, cwd ?? undefined);
        assert.equal(queries[0].queryKey[1], cwd ?? undefined);
        assert.deepEqual(rows.map((row) => row.id),
            cwd === '/repo/current' ? ['current'] : cwd === '/repo/other' ? ['other'] : ['current', 'nested', 'other']);
    }
});

test('shared Android source patch matches the bundle semantics and rejects drift', () => {
    const patched = patchedImportSource(nativeSource);
    assert.equal(patchedImportSource(patched), patched);
    assert.equal(patched.split(SOURCE_IMPORT_CWD).length, 2);
    assert.throws(() => patchedImportSource(nativeSource + '\n'), /source hash mismatch/);
    for (const cwd of ['/repo/current', null]) {
        const options = new Script(SOURCE_IMPORT_CWD).runInNewContext({
            useImportSession: (value) => value,
            selectedServerId: 'host', selectedSourceDirectory: cwd,
        });
        assert.equal(options.serverId, 'host');
        assert.equal(options.cwd, cwd ?? undefined);
    }
});
