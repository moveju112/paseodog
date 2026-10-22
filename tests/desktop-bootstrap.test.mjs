import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { configure } from '../scripts/configure.mjs';
import { prepareDesktopRuntime, runtimeFiles } from '../scripts/prepare-desktop-runtime.mjs';
import { engineEnvironment } from '../plugin/server/util.mjs';

const require = createRequire(import.meta.url);

test('only the self Electron engine restores Node mode after upstream environment sanitization', () => {
    const launch = { command: '/bundle/PaseoDog.bin', env: { MIXDOG_HOME: '/dedicated/mixdog' } };
    assert.deepEqual(engineEnvironment(launch, { isElectron: true, execPath: launch.command }),
        { MIXDOG_HOME: '/dedicated/mixdog', ELECTRON_RUN_AS_NODE: '1' });
    assert.deepEqual(launch.env, { MIXDOG_HOME: '/dedicated/mixdog' });
    assert.deepEqual(engineEnvironment(launch, { isElectron: false, execPath: launch.command }), launch.env);
    assert.deepEqual(engineEnvironment(launch, { isElectron: true, execPath: '/different/electron' }), launch.env);
});

test('desktop config uses its dedicated listener, Electron Node mode and absolute engine argv', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-desktop-config-'));
    t.after(() => rmSync(root, { recursive: true }));
    const file = configure({
        home: join(root, 'paseo'), nativeHome: join(root, 'mixdog'), stateDir: join(root, 'sessions'),
        enginePath: join(root, 'engine with spaces.mjs'), trustPlugins: true,
        engineEnv: { ELECTRON_RUN_AS_NODE: '1' }, defaultListen: '127.0.0.1:6768',
    });
    const config = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(config.daemon.listen, '127.0.0.1:6768');
    assert.equal(config.daemon.relay.enabled, false);
    assert.equal(config.agents.providers.paseodog.env.ELECTRON_RUN_AS_NODE, '1');
    assert.deepEqual(config.agents.providers.paseodog.command, [process.execPath, join(root, 'engine with spaces.mjs')]);
    assert.equal(config.plugins, undefined);
});

test('runtime packager rejects unsupported targets before writing files', async () => {
    await assert.rejects(prepareDesktopRuntime({ platform: 'win32', arch: 'arm64' }), /Unsupported/);
});

test('packaged patch entry point imports with only the declared runtime scripts and patches', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-runtime-import-'));
    t.after(() => rmSync(root, { recursive: true }));
    for (const name of runtimeFiles.filter((name) => /^(scripts|patches)\//.test(name))) {
        const target = join(root, name);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(new URL('../' + name, import.meta.url), target);
    }
    const bundled = await import(pathToFileURL(join(root, 'scripts/patch-mixdog.mjs')).href);
    assert.equal(typeof bundled.patch, 'function');
});

test('Android user-facing version can follow the common release version without losing its fallback', () => {
    const { configureVersionNameOverride } = require('../android/packages/app/plugins/with-android-version-code.js');
    const result = configureVersionNameOverride('    versionName "0.11.4"');
    assert.equal(result, "    versionName (findProperty('paseodogVersionName') ?: '0.11.4').toString()");
    assert.equal(configureVersionNameOverride(result), result);
    assert.throws(() => configureVersionNameOverride('unreviewed'), /literal versionName/);
});
