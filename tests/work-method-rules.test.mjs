import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AGENT_PATCHES, patchedAgentSource } from '../scripts/patch-mixdog.mjs';

const root = new URL('../engine/node_modules/mixdog/', import.meta.url);
const files = [
    'src/rules/shared/05-tool-calls.md',
    'src/rules/shared/10-tool-workflow.md',
    'src/rules/shared/20-research.md',
    'src/rules/shared/35-implementation.md',
    'src/rules/shared/45-destructive.md',
    'src/rules/shared/60-verification.md',
    'src/rules/lead/LEAD.md',
    'src/runtime/agent/orchestrator/tools/builtin/builtin-tools.mjs',
];
const specFor = (file) => {
    const spec = AGENT_PATCHES.find((entry) => entry.file === file);
    assert.ok(spec, `Missing persistent work-method patch: ${file}`);
    return spec;
};
const originalSource = (source, spec) => [...spec.edits].reverse()
    .reduce((text, [before, after]) => text.replace(after, before), source);

test('installer covers every selected shared rule and tool-description target', async () => {
    for (const file of files) specFor(file);
    assert.equal(new Set(AGENT_PATCHES.map(({ file }) => file)).size, AGENT_PATCHES.length);
    const manifest = await readFile(new URL('../MANIFEST.sha256', import.meta.url), 'utf8');
    const entries = new Set(manifest.trim().split('\n').map((line) => line.split('  ')[1]));
    assert.ok(entries.has('patches/work-method-rules.mjs'));
    assert.ok(entries.has('tests/work-method-rules.test.mjs'));
});

test('work-method patches accept pinned originals and reject drift and partial application', async () => {
    for (const file of files) {
        const spec = specFor(file);
        const source = await readFile(new URL(file, root), 'utf8');
        const original = originalSource(source, spec);
        const patched = patchedAgentSource(original, spec);
        assert.equal(patchedAgentSource(patched, spec), patched);
        assert.throws(() => patchedAgentSource(`${original}\nDRIFT\n`, spec), /source hash mismatch/);
        if (spec.edits.length > 1) {
            const [before, after] = spec.edits[0];
            assert.throws(() => patchedAgentSource(original.replace(before, after), spec),
                /Partial Mixdog patch/);
        }
    }
});

test('rendered rules omit optional mandates while retaining safety and English briefing contracts', () => {
    const require = createRequire(import.meta.url);
    const builder = require(fileURLToPath(new URL('src/lib/rules-builder.cjs', root)));
    const options = { PLUGIN_ROOT: fileURLToPath(new URL('src/', root)) };
    const shared = builder.buildSharedToolContent(options);
    const lead = builder.buildLeadRoleContent(options);
    assert.doesNotMatch(shared, /Stop once every requested item|never widen past what was asked/);
    assert.match(shared, /Never ask permission for work the\s+request already covers/);
    assert.doesNotMatch(shared, /Group calls already known|combine compatible targets|Order on files:/);
    assert.doesNotMatch(shared, /web search non-Project facts|Separate-branch work goes into a managed worktree/);
    assert.doesNotMatch(shared, /No builds\/lint\/tests\/formatters mid-flight|Never reread your writes/);
    assert.doesNotMatch(shared, /Smallest implementation that meets the full contract/);
    assert.doesNotMatch(lead, /each feature[\s\S]*gets one fresh Reviewer/);
    assert.match(shared, /Current or external information discovery→`web_search`/);
    assert.match(shared, /any irreversible action only on the\s+user's explicit request/);
    assert.match(shared, /Never stash, reset, checkout, restore or clean/);
    assert.match(shared, /Back up only when changes risk irreversible loss/);
    assert.match(shared, /Check required behavior, exact outputs and essential integrity, security/);
    assert.match(shared, /rerun only failed or invalidated\s+checks/i);
    assert.match(lead, /one self-contained English brief/);
    assert.match(lead, /Evidence verbatim/);
    assert.match(lead, /check cross-feature seams and run affected suites once/);
});

test('read and grep guidance changes leave all tool arguments and annotations unchanged', async () => {
    const file = files.at(-1);
    const url = new URL(file, root);
    const spec = specFor(file);
    const source = await readFile(url, 'utf8');
    const patched = patchedAgentSource(source, spec);
    // 원본과 패치본은 같은 의존성을 읽고 공개 도구 계약만 비교한다.
    const load = (text) => import(`data:text/javascript;base64,${Buffer.from(text.replace(
        /from (['"])(\.[^'"]+)\1/g,
        (_match, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`,
    )).toString('base64')}`);
    const before = await load(originalSource(patched, spec));
    const after = await load(patched);
    const contracts = (tools) => tools.map(({ description, ...contract }) => contract);
    assert.deepEqual(contracts(after.BUILTIN_TOOLS), contracts(before.BUILTIN_TOOLS));
    const descriptions = after.BUILTIN_TOOLS.map(({ description }) => description).join('\n');
    assert.doesNotMatch(descriptions, /One call per read stage|Content in context is never read again/);
    assert.doesNotMatch(descriptions, /every pattern and scope in one call/);
    assert.match(descriptions, /Missing paths are reported, never replaced/);
    assert.match(descriptions, /Never count rows/);
});
