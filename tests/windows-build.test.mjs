import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsBuildCommands, windowsBuildMode, WINDOWS_WINE_IMAGE } from '../scripts/windows-build.mjs';

const builder = ['npx', 'electron-builder', '--config', 'electron-builder.cjs',
    '-c.directories.output=/build out/desktop', '--publish', 'never'];
const input = { builder, root: '/source tree', workspace: '/build out', uid: 1234, gid: 5678 };

test('host remains the default and invalid Windows build modes are rejected', () => {
    assert.equal(windowsBuildMode(), 'host');
    assert.deepEqual(windowsBuildCommands(input), [[...builder, '--win', 'nsis', '--x64']]);
    for (const mode of ['auto', '', null, false]) assert.throws(() => windowsBuildMode(mode), /host or docker/);
});

test('docker prepares the app on host then packages it without exposing personal Wine state', () => {
    const [prepare, pack] = windowsBuildCommands({ ...input, mode: 'docker' });
    assert.deepEqual(prepare, [...builder, '--win', '--x64', '--dir']);
    assert.equal(pack[0], 'docker');
    assert.equal(pack[pack.indexOf('--user') + 1], '1234:5678');
    assert.ok(pack.includes('/source tree:/source tree:ro'));
    assert.ok(pack.includes('/build out:/build out'));
    assert.ok(pack.includes(WINDOWS_WINE_IMAGE));
    assert.match(WINDOWS_WINE_IMAGE, /@sha256:[a-f0-9]{64}$/);
    assert.ok(pack.includes('/source tree/android/node_modules/electron-builder/out/cli/cli.js'));
    assert.equal(pack[pack.indexOf('--prepackaged') + 1], '/build out/desktop/win-unpacked');
    assert.equal(pack[pack.indexOf('--publish') + 1], 'never');
    assert.equal(pack.includes('--privileged'), false);
    assert.equal(pack.some(arg => arg.includes('/var/run/docker.sock')), false);
    assert.equal(builder.includes('--win'), false);
    assert.equal(builder.includes('--dir'), false);
});
