import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareStabilityBackports } from '../scripts/prepare-mixdog-stability.mjs';
import { patchedAgentSource, gitBlob, AGENT_PATCHES, HOST_PATCHES } from '../scripts/patch-mixdog.mjs';
import { STABILITY_BACKPORTS, STABILITY_FILES, withStabilityBackports } from '../patches/mixdog-stability.mjs';

const directory = mkdtempSync(join(tmpdir(), 'paseodog-backport-generation-'));
after(() => rmSync(directory, { recursive: true, force: true }));

test('generated source edits preserve dollar sequences and final newline semantics', () => {
    const sourceRoot = join(directory, 'original'), backportRoot = join(directory, 'backported');
    mkdirSync(join(sourceRoot, 'src'), { recursive: true });
    mkdirSync(join(backportRoot, 'src'), { recursive: true });
    writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ version: '1.4.1' }));
    const file = 'src/fixture.mjs';
    const before = 'export const sql = "old";\n';
    const after = 'export const sql = "$$ $& $` $\' $${index}";';
    writeFileSync(join(sourceRoot, file), before);
    writeFileSync(join(backportRoot, file), after);
    const generated = prepareStabilityBackports({ sourceRoot, backportRoot, provenance: { [file]: ['fixture'] } });
    assert.equal(generated.patches.length, 1);
    assert.equal(generated.patches[0].blob, gitBlob(before));
    assert.equal(patchedAgentSource(before, generated.patches[0]), after);
    assert.equal(patchedAgentSource(after, generated.patches[0]), after);
    assert.throws(() => patchedAgentSource(before + '// unknown\n', generated.patches[0]), /hash mismatch/);
});

test('backports preserve old host-patched installations and reject unknown partial edits', () => {
    const before = 'const a = 1;\nconst b = 1;\n';
    const host = { file: 'fixture.mjs', blob: gitBlob(before), edits: [['const a = 1;', 'const a = 2;']] };
    const stable = { file: host.file, blob: host.blob, edits: [['const b = 1;', 'const b = 2;']] };
    const [merged] = withStabilityBackports([host], [stable]);
    const after = 'const a = 2;\nconst b = 2;\n';
    assert.equal(patchedAgentSource(before, merged), after);
    assert.equal(patchedAgentSource(patchedAgentSource(before, host), merged), after);
    assert.equal(patchedAgentSource(after, merged), after);
    assert.throws(() => patchedAgentSource('const a = 1;\nconst b = 2;\n', merged), /Partial/);
    assert.throws(() => withStabilityBackports([host], [{ ...stable, blob: gitBlob('unknown') }]), /base mismatch/);
    assert.equal(withStabilityBackports(HOST_PATCHES).length, AGENT_PATCHES.length);
});

test('stability targets retain exact upstream pins and do not shadow host files', () => {
    const files = [...AGENT_PATCHES, ...STABILITY_FILES].map(spec => spec.file);
    assert.equal(new Set(files).size, files.length);
    assert.ok(STABILITY_BACKPORTS.length > 0);
    for (const spec of STABILITY_BACKPORTS) {
        assert.match(spec.blob, /^[a-f0-9]{40}$/);
        assert.ok(spec.commits.length > 0);
    }
});
