import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { VERSION, UPSTREAM_VERSIONS } from '../plugin/server/util.mjs';
import { PIN } from '../scripts/patch-mixdog.mjs';

// 제품 버전과 기반 버전이 독립적이면서 실제 패키지·잠금파일과 일치하는지 확인한다.
test('independent product version and upstream provenance stay consistent', () => {
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
    assert.equal(VERSION, root.version);
    assert.deepEqual(UPSTREAM_VERSIONS, root.paseodogUpstream);
    assert.equal(UPSTREAM_VERSIONS.mixdog, PIN);
    for (const directory of ['engine', 'plugin', 'tools']) {
        const manifest = JSON.parse(readFileSync(new URL(`../${directory}/package.json`, import.meta.url)));
        const lock = JSON.parse(readFileSync(new URL(`../${directory}/package-lock.json`, import.meta.url)));
        assert.equal(manifest.version, VERSION);
        assert.equal(lock.version, VERSION);
        assert.equal(lock.packages[''].version, VERSION);
        const dependencies = manifest.dependencies || manifest.devDependencies;
        const name = directory === 'engine' ? 'mixdog' : directory === 'tools' ? '@getpaseo/cli' : '@getpaseo/plugin';
        assert.equal(dependencies[name], directory === 'engine' ? UPSTREAM_VERSIONS.mixdog : UPSTREAM_VERSIONS.paseo);
    }
    const cli = execFileSync(process.execPath, [new URL('../bin/paseodog.mjs', import.meta.url).pathname, '--version'], { encoding: 'utf8' });
    assert.equal(cli.trim(), `PaseoDog ${VERSION} (Paseo ${UPSTREAM_VERSIONS.paseo}, Mixdog ${UPSTREAM_VERSIONS.mixdog})`);
    const engine = execFileSync(process.execPath, [new URL('../engine/bin/paseodog-engine.mjs', import.meta.url).pathname, '--version'], { encoding: 'utf8' });
    assert.equal(engine.trim(), VERSION);
});
