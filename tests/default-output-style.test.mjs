import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import metadata from '../engine/node_modules/mixdog/src/lib/output-style-meta.cjs';
import rulesBuilder from '../engine/node_modules/mixdog/src/lib/rules-builder.cjs';
import {
    listOutputStyleCatalog, findOutputStyle, outputStyleStatus,
} from '../engine/node_modules/mixdog/src/session-runtime/output-styles.mjs';
import { createStyleAndModeApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/style-and-mode.mjs';
import { createOutputStyleStatusCache } from '../engine/node_modules/mixdog/src/session-runtime/config-lifecycle/output-style-cache.mjs';
import { configWithOutputStyle } from '../engine/node_modules/mixdog/src/session-runtime/config-lifecycle/config-writers.mjs';
import { patchedAgentSource } from '../scripts/patch-mixdog.mjs';
import { DEFAULT_OUTPUT_STYLE_PATCHES } from '../patches/default-output-style.mjs';

const root = fileURLToPath(new URL('../engine/node_modules/mixdog/src/', import.meta.url));
const existingIds = ['detailed', 'simple', 'minimal', 'extreme-minimal'];
const precedence = 'The section below governs how you write user-facing text; it outranks any other formatting habit and does not apply to code or tool calls.';

// 격리된 설정·사용자 스타일만 만들고 종료 시 삭제한다(잔여물은 /data/tmp의 3일 정책 적용).
async function styleFixture(t, initial = {}) {
    const directory = await mkdtemp('/data/tmp/ubuntu/paseodog-output-style-');
    t.after(() => rm(directory, { recursive: true }));
    const configPath = join(directory, 'mixdog-config.json');
    await writeFile(configPath, JSON.stringify(initial));
    await mkdir(join(directory, 'output-styles'));
    return { directory, configPath };
}

// 실제 파일의 본문을 독립적으로 읽어 비기본 스타일의 지시 보존을 비교한다.
async function styleBody(id) {
    return (await readFile(join(root, 'output-styles', `${id}.md`), 'utf8'))
        .replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').trim();
}

test('native default metadata and catalog add a no-op without replacing the absent-setting simple default', async (t) => {
    const { directory, configPath } = await styleFixture(t);
    assert.equal(metadata.DEFAULT_OUTPUT_STYLE_ID, 'simple');
    assert.equal(metadata.NO_OUTPUT_STYLE.id, 'default');
    assert.equal(metadata.NO_OUTPUT_STYLE.keepSharedFormat, false);
    const styles = listOutputStyleCatalog(root, directory, { fresh: true });
    assert.deepEqual(styles.map((style) => style.id), ['default', ...existingIds]);
    assert.equal(findOutputStyle(' DEFAULT ', styles).id, 'default');
    assert.equal(findOutputStyle('extreme_minimal', styles).id, 'extreme-minimal');
    assert.equal(outputStyleStatus(root, directory).current.id, 'simple');
    await writeFile(configPath, JSON.stringify({ outputStyle: 'default' }));
    const status = outputStyleStatus(root, directory, { fresh: true });
    assert.equal(status.configured, 'default');
    assert.equal(status.current.id, 'default');
    assert.equal(status.current.source, 'builtin');
});

test('explicit default injects absolutely nothing even with conflicting user files and aliases', async (t) => {
    const { directory, configPath } = await styleFixture(t, { outputStyle: ' DEFAULT ' });
    for (const [name, body] of [
        ['default', '---\nname: default\ntitle: Hijacked\n---\nUNWANTED DEFAULT'],
        ['custom', '---\nname: custom\naliases: default\n---\nUNWANTED ALIAS'],
        ['common', 'UNWANTED COMMON'],
    ]) {
        await writeFile(join(directory, 'output-styles', `${name}.md`), body);
    }
    const before = await readFile(configPath, 'utf8');
    assert.equal(outputStyleStatus(root, directory, { fresh: true }).current.id, 'default');
    assert.equal(rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory }), '');
    assert.equal(await readFile(configPath, 'utf8'), before);
    const styles = listOutputStyleCatalog(root, directory, { fresh: true });
    assert.equal(styles.filter((style) => style.id === 'default').length, 1);
    assert.equal(findOutputStyle('default', styles).label, 'Default');
    assert.ok(findOutputStyle('custom', styles));
});

test('native style switching preserves existing instructions and explicit default across reopen', async (t) => {
    const { directory, configPath } = await styleFixture(t, { peer: true });
    let config = JSON.parse(readFileSync(configPath, 'utf8'));
    const cache = createOutputStyleStatusCache({
        cfgMod: { getPluginData: () => directory },
        STANDALONE_DATA_DIR: directory,
        resolve: (value) => value,
        performanceNow: () => performance.now(),
        outputStyleStatus: (dataDir, options) => outputStyleStatus(root, dataDir, options),
    });
    const api = createStyleAndModeApi({
        ...cache,
        getConfig: () => config,
        getSession: () => null,
        adoptConfig: (next) => { config = next; },
        displayConfig: () => config,
        scheduleOutputStyleSave: (id) => {
            const disk = JSON.parse(readFileSync(configPath, 'utf8'));
            writeFileSync(configPath, JSON.stringify(configWithOutputStyle(disk, id)));
        },
        invalidateContextStatusCache() {},
    });
    const common = await styleBody('common');
    assert.ok(common);
    for (const id of [...existingIds, 'simple']) {
        await api.setOutputStyle(id.toUpperCase().replaceAll('-', '_'));
        assert.equal(api.getOutputStyle().current.id, id);
        const selected = await styleBody(id);
        const prompt = rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory });
        assert.ok(selected);
        assert.ok(prompt.includes(selected));
        assert.ok(prompt.includes(common));
        assert.ok(prompt.includes(precedence));
        assert.ok(prompt.includes(`# Output Style: ${findOutputStyle(id, api.listOutputStyles().styles).label}`));
        await api.setOutputStyle('default');
        assert.equal(api.getOutputStyle().current.id, 'default');
        assert.equal(config.outputStyle, 'default');
        assert.equal(rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory }), '');
        assert.equal(outputStyleStatus(root, directory, { fresh: true }).current.id, 'default');
        assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { peer: true, outputStyle: 'default' });
    }
    await api.setOutputStyle('simple');
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { peer: true });
    assert.equal(outputStyleStatus(root, directory, { fresh: true }).current.id, 'simple');
    await assert.rejects(api.setOutputStyle('missing-style-fixture'), /output style must be one of/);
    assert.equal(api.getOutputStyle().current.id, 'simple');
});

test('default preserves profile preferences and non-default user overrides still replace common formatting', async (t) => {
    const profile = { title: 'Style Fixture' };
    const { directory, configPath } = await styleFixture(t, { profile, outputStyle: 'default' });
    await writeFile(join(directory, 'output-styles', 'simple.md'),
        '---\nname: simple\ntitle: Custom Simple\nkeep-shared-format: false\n---\nCUSTOM STANDALONE BODY');
    await writeFile(join(directory, 'output-styles', 'common.md'), 'CUSTOM COMMON BODY');
    const profileOnly = rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory });
    assert.ok(profileOnly.includes('# Profile Preferences'));
    assert.ok(profileOnly.includes('Style Fixture'));
    assert.ok(!profileOnly.includes('# Output Style:'));
    assert.ok(!profileOnly.includes(precedence));
    assert.ok(!profileOnly.includes('CUSTOM'));
    await writeFile(configPath, JSON.stringify({ profile, outputStyle: 'simple' }));
    assert.equal(outputStyleStatus(root, directory, { fresh: true }).current.id, 'simple');
    const custom = rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory });
    assert.ok(custom.includes(profileOnly));
    assert.ok(custom.includes('# Output Style: Custom Simple'));
    assert.ok(custom.includes(precedence));
    assert.ok(custom.includes('CUSTOM STANDALONE BODY'));
    assert.ok(!custom.includes('CUSTOM COMMON BODY'));
    await writeFile(configPath, JSON.stringify({ profile, outputStyle: 'default' }));
    assert.equal(rulesBuilder.buildLeadMetaContent({ PLUGIN_ROOT: root, DATA_DIR: directory }), profileOnly);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { profile, outputStyle: 'default' });
});

test('default output style patches are idempotent and reject source drift', async () => {
    for (const spec of DEFAULT_OUTPUT_STYLE_PATCHES) {
        const source = await readFile(join(root, '..', spec.file), 'utf8');
        const patched = patchedAgentSource(source, spec);
        assert.equal(patchedAgentSource(patched, spec), patched);
        assert.throws(() => patchedAgentSource(`${source}\n// drift\n`, spec), /source hash mismatch/);
    }
});
