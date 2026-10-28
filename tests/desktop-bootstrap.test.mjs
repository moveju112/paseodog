import test from 'node:test';
import assert from 'node:assert/strict';
import { scratchPath } from '../scripts/paths.mjs';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { configure } from '../scripts/configure.mjs';
import { copyRuntimeSources, prepareDesktopRuntime, runtimeFiles } from '../scripts/prepare-desktop-runtime.mjs';
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

test('runtime packaging preserves source bytes but makes private sources readable after root installation', async t => {
    const root = mkdtempSync(scratchPath('paseodog-runtime-modes-'));
    t.after(() => rmSync(root, { recursive: true }));
    const source = join(root, 'source'), output = join(root, 'output');
    const directories = ['engine/bin', 'engine/src', 'plugin/server', 'plugin/client', 'plugin/shared'];
    for (const name of runtimeFiles) {
        const path = join(source, name);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        if (directories.includes(name)) {
            mkdirSync(path, { mode: 0o700 });
            writeFileSync(join(path, name === 'engine/bin' ? 'engine.mjs' : 'release.json'), name,
                { mode: name === 'engine/bin' ? 0o700 : 0o600 });
        } else {
            writeFileSync(path, name, { mode: 0o600 });
        }
    }
    await copyRuntimeSources(source, output);
    for (const name of runtimeFiles.filter(name => name !== 'engine/bin')) {
        const file = directories.includes(name) ? join(name, 'release.json') : name;
        assert.equal(readFileSync(join(output, file), 'utf8'), name);
        assert.equal(statSync(join(output, file)).mode & 0o777, 0o644);
        assert.equal(statSync(join(source, file)).mode & 0o777, 0o600);
    }
    assert.equal(statSync(join(output, 'engine/bin/engine.mjs')).mode & 0o777, 0o755);
    for (const name of ['', 'engine', 'engine/bin', 'plugin', 'plugin/shared'])
        assert.equal(statSync(join(output, name)).mode & 0o777, 0o755);
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
    const checked = bundled.patch(fileURLToPath(new URL('../engine/node_modules/mixdog/', import.meta.url)), { check: true });
    assert.equal(checked.patched, true);
    assert.equal(checked.version, bundled.PIN);
});

test('Android user-facing version can follow the common release version without losing its fallback', () => {
    const { configureVersionNameOverride } = require('../android/packages/app/plugins/with-android-version-code.js');
    const result = configureVersionNameOverride('    versionName "0.11.4"');
    assert.equal(result, "    versionName (findProperty('paseodogVersionName') ?: '0.11.4').toString()");
    assert.equal(configureVersionNameOverride(result), result);
    assert.throws(() => configureVersionNameOverride('unreviewed'), /literal versionName/);
});
