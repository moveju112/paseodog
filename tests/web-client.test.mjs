import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWeb } from '../scripts/build-web.mjs';

const require = createRequire(new URL('../android/packages/app/package.json', import.meta.url));
const { getConfig } = require('@expo/config');
const appRoot = new URL('../android/packages/app/', import.meta.url).pathname;

test('Pages base path is opt-in and leaves ordinary app builds unchanged', () => {
    const previous = process.env.PASEODOG_WEB_BASE_PATH;
    try {
        delete process.env.PASEODOG_WEB_BASE_PATH;
        assert.equal(getConfig(appRoot).exp.experiments.baseUrl, undefined);
        process.env.PASEODOG_WEB_BASE_PATH = '/paseodog';
        assert.equal(getConfig(appRoot).exp.experiments.baseUrl, '/paseodog');
    } finally {
        if (previous === undefined) delete process.env.PASEODOG_WEB_BASE_PATH;
        else process.env.PASEODOG_WEB_BASE_PATH = previous;
    }
});

test('web export isolates browser configuration and preserves SPA deep links on Pages', async (t) => {
    const output = await mkdtemp(join(tmpdir(), 'paseodog-web-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    const calls = [];
    const html = '<!doctype html><script src="/paseodog/_expo/app.js"></script>';
    await buildWeb({ output }, async (command, args, { cwd, env }) => {
        calls.push({ command, args, cwd });
        assert.equal(env.PASEO_WEB_PLATFORM, '');
        assert.equal(env.PASEODOG_WEB_BASE_PATH, '/paseodog');
        assert.equal(env.APP_VARIANT, 'production');
        if (command === 'npx') await writeFile(join(output, 'index.html'), html);
    });
    assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
        ['npm', 'run', 'build:app-deps'],
        ['npx', 'expo', 'export', '--platform', 'web', '--output-dir', output, '--max-workers', '2'],
    ]);
    assert.equal(await readFile(join(output, '404.html'), 'utf8'), html);
    assert.equal(await readFile(join(output, '.nojekyll'), 'utf8'), '');
});

test('web build stops on failure before exporting or preparing Pages files', async () => {
    const calls = [];
    await assert.rejects(buildWeb({ output: '/unused' }, async (command) => {
        calls.push(command);
        throw new Error('dependencies failed');
    }), /dependencies failed/);
    assert.deepEqual(calls, ['npm']);
    await assert.rejects(buildWeb({ output: 'relative' }), /absolute path/);
    await assert.rejects(buildWeb({ output: '/unused', metroWorkers: '0' }), /positive integer/);
    await assert.rejects(buildWeb({ output: '/unused', hosting: 'unknown' }), /github or cloudflare/);
});

test('Cloudflare exports root assets without overriding its built-in SPA fallback', async (t) => {
    const output = await mkdtemp(join(tmpdir(), 'paseodog-web-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    const html = '<!doctype html><script src="/_expo/app.js"></script>';
    await buildWeb({ output, hosting: 'cloudflare' }, async (command, args, { env }) => {
        assert.equal(env.PASEODOG_WEB_BASE_PATH, '');
        assert.equal(env.PASEO_WEB_PLATFORM, '');
        assert.equal(env.APP_VARIANT, 'production');
        if (command === 'npx') await writeFile(join(output, 'index.html'), html);
    });
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), html);
    await assert.rejects(readFile(join(output, '404.html')), { code: 'ENOENT' });
});
