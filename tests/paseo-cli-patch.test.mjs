import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CLI_VERSION, ORIGINAL_HASHES, patchPermitSource, patchInstalledCli,
} from '../scripts/patch-paseo-cli.mjs';

// 보존 fixture: @getpaseo/cli@0.11.4 dist/commands/permit/{allow,deny}.js 원본.
// Copyright (c) 2025-present Mohamed Boudra.
// SPDX-License-Identifier: Apache-2.0; 전체 라이선스는 프로젝트 LICENSE 참조.
// 원본에는 마지막 개행이 없으므로 txt 저장용 개행 1개만 제거한다.
// 해시로 원본 바이트 일치를 검증하며, node_modules는 읽지 않는다.
const originals = Object.fromEntries(await Promise.all(['allow', 'deny'].map(async action => [
    action, (await readFile(new URL(`./fixtures/paseo-cli-${action}-0.11.4.js.txt`, import.meta.url), 'utf8')).slice(0, -1),
])));

test('retained actual 0.11.4 sources match audited hashes and patch idempotently', () => {
    for (const action of ['allow', 'deny']) {
        const original = originals[action];
        assert.equal(createHash('sha256').update(original).digest('hex'), ORIGINAL_HASHES[action]);
        const patched = patchPermitSource(original, action);
        assert.notEqual(patched, original);
        assert.equal(patchPermitSource(patched, action), patched);
        assert.throws(() => patchPermitSource(original + '\n', action), /source drift/);
        assert.throws(() => patchPermitSource(patched + '\n', action), /source drift/);
    }
});

test('fixture install verifies both files before writing and rejects source/version drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paseo-cli-patch-'));
    try {
        await mkdir(join(root, 'dist/commands/permit'), { recursive: true });
        for (const action of ['allow', 'deny']) {
            await writeFile(join(root, `dist/commands/permit/${action}.js`), originals[action]);
        }
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@getpaseo/cli', version: CLI_VERSION }));
        await assert.rejects(patchInstalledCli('--check', root), /not installed/);
        await writeFile(join(root, 'dist/commands/permit/deny.js'), originals.deny + '\n');
        await assert.rejects(patchInstalledCli('--apply', root), /source drift/);
        assert.equal(await readFile(join(root, 'dist/commands/permit/allow.js'), 'utf8'), originals.allow);
        await writeFile(join(root, 'dist/commands/permit/deny.js'), originals.deny);
        await patchInstalledCli('--apply', root);
        await patchInstalledCli('--check', root);
        await patchInstalledCli('--apply', root);
        for (const action of ['allow', 'deny']) {
            assert.equal(await readFile(join(root, `dist/commands/permit/${action}.js`), 'utf8'),
                patchPermitSource(originals[action], action));
        }
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@getpaseo/cli', version: '0.12.0' }));
        await assert.rejects(patchInstalledCli('--apply', root), /version drift/);
    } finally {
        await rm(root, { recursive: true });
    }
});
