import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
    readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { processEngineFactory, stopEngineProcessGroup } from '../plugin/server/process-engine.mjs';
import { createProcessScope } from '../plugin/server/process-scope.mjs';
import { runtimeEnv, scratchRoot, supportedNode } from './paths.mjs';
import { patch } from './patch-mixdog.mjs';
import { withTestLock } from './test.mjs';
import { fixtures } from '../tests/fixtures/workflow-token-benchmark.mjs';
import { largeFixture, evaluateLargeAnswer } from '../tests/fixtures/workflow-token-large.mjs';

const taskFixtures = { ...fixtures, large: largeFixture };

export const route = Object.freeze({
    provider: 'openai-oauth', model: 'gpt-6.1-sol', effort: 'xhigh',
    autoEffort: false, fast: false, fallbacks: [],
});
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
export const envelope = 'Work only in the supplied fixture directory. This is a read-only audit: '
    + 'use read/list/glob/grep/find/code_graph and agent tools, not shell, network or file writes. '
    + 'At most two child workers total; children must not delegate. Only the worker role is allowed, '
    + 'using openai-oauth/gpt-6.1-sol, xhigh, autoEffort false, fast false, no fallback. '
    + 'Do not access any other project, profile, credentials or configuration. '
    + 'Do not retry a denied action. Finish within ten minutes.';
const readTools = new Set(['read', 'list', 'glob', 'grep', 'find', 'code_graph', 'head', 'tail']);

export function evaluateAnswer(task, content) {
    if (task === 'large') return evaluateLargeAnswer(content);
    try {
        const trimmed = content.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
        const actual = JSON.parse(trimmed);
        return { pass: isDeepStrictEqual(actual, fixtures[task].expected), actual };
    } catch {
        return { pass: false, error: 'Answer is not a single JSON object' };
    }
}

export function createApprovalPolicy(cwd) {
    let spawns = 0;
    const inside = (path, base = cwd) => {
        if (typeof path !== 'string') return false;
        const full = resolve(base, path);
        const rel = relative(cwd, full);
        if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return false;
        let ancestor = full;
        while (!existsSync(ancestor)) ancestor = dirname(ancestor);
        const real = relative(realpathSync(cwd), realpathSync(ancestor));
        if (real === '..' || real.startsWith('../') || isAbsolute(real)) return false;
        return true;
    };
    return (info) => {
        const args = info.args || {};
        if (!inside(info.cwd || cwd)) return { approved: false, reason: 'Outside fixture cwd' };
        if (info.name === 'load_tool') return { approved: true };
        if (readTools.has(info.name)) {
            if (args.cwd !== undefined && !inside(args.cwd))
                return { approved: false, reason: 'Outside explicit tool cwd' };
            const base = resolve(cwd, args.cwd || info.cwd || '.');
            const paths = info.name === 'read' ? args.file_path : args.path ?? args.files;
            const items = paths === undefined ? ['.'] : Array.isArray(paths) ? paths : [paths];
            return { approved: items.every((item) => inside(typeof item === 'object' ? item.file_path : item, base)),
                reason: 'Fixture-only read policy' };
        }
        if (info.name === 'task') {
            return { approved: ['list', 'read', 'wait', 'cancel'].includes(args.action)
                && (args.action === 'list' || typeof args.task_id === 'string')
                && !args.global && !args.allTerminals && !args.recover,
            reason: 'Native session-scoped background-task actions only' };
        }
        if (info.name === 'agent') {
            if (args.global || args.allTerminals || args.recover)
                return { approved: false, reason: 'Cross-session control denied' };
            if ((args.file && !inside(args.file)) || (args.attachments || []).some((path) => !inside(path)))
                return { approved: false, reason: 'Outside agent input path' };
            if (args.type === 'spawn') {
                if (info.childSessionId || spawns >= 2 || args.agent !== 'worker')
                    return { approved: false, reason: 'Worker/depth budget exceeded' };
                for (const key of ['provider', 'model', 'effort', 'autoEffort', 'fast']) {
                    if (args[key] !== undefined && args[key] !== route[key])
                        return { approved: false, reason: 'Unpinned worker route' };
                }
                if (args.cwd && !inside(args.cwd)) return { approved: false, reason: 'Outside worker cwd' };
                spawns++;
                return { approved: true };
            }
            if (['send', 'list', 'status', 'close', 'cancel', 'read', 'cleanup'].includes(args.type))
                return { approved: true };
        }
        return { approved: false, reason: 'Tool outside read-only benchmark envelope' };
    };
}

export function summarizeUsage(rows, deltas, leadId) {
    const sum = (group) => {
        const reasoning = deltas.filter((delta) => group.some((row) => row.sessionId === delta.sessionId));
        return {
            requests: group.length,
            input: group.reduce((total, row) => total + row.input, 0),
            cachedInput: group.reduce((total, row) => total + row.cachedInput, 0),
            noncachedInput: group.reduce((total, row) => total + row.input - row.cachedInput, 0),
            output: group.reduce((total, row) => total + row.output, 0),
            reasoning: reasoning.length === group.length && reasoning.every((delta) =>
                delta.reasoningTokens != null && delta.reasoningTokensComplete === true)
                ? reasoning.reduce((total, delta) => total + delta.reasoningTokens, 0) : null,
            providerRequestMs: group.reduce((total, row) => total + row.durationMs, 0),
        };
    };
    return { total: sum(rows), lead: sum(rows.filter((row) => row.sessionId === leadId)),
        workers: sum(rows.filter((row) => row.sessionId !== leadId)),
        semantics: 'input includes cachedInput; noncachedInput = input - cachedInput; reasoning is a subset of output; neither subset is added to total; no monetary or quota savings are inferred' };
}

export function assertCompletedJobs(jobs, leadId) {
    assert.ok(new Set(jobs.map((job) => job.sessionId)).size <= 2, 'Worker budget exceeded');
    assert.ok(jobs.every((job) => job.status === 'completed'),
        'Child job failed, was cancelled, or did not complete; provider usage may be unreported');
    assert.ok(jobs.every((job) => job.model === route.model && job.provider === route.provider
        && job.effort === route.effort && job.ownerSessionId === leadId), 'Worker route/ownership mismatch');
}

export function verifyOffPrompt(session, workflowBodies) {
    assert.equal(session.workflow?.id, 'none', 'OFF must use the actual native none workflow');
    assert.ok(workflowBodies.length === 3 && workflowBodies.every((body) => body.trim()),
        'OFF prompt verification requires the three unchanged ON bodies');
    const system = session.messages.filter((message) => message.role === 'system'
        && typeof message.content === 'string').map((message) => message.content);
    assert.ok(system.includes(envelope), 'The effective lead prompt lost the common safety envelope');
    const combined = system.join('\n');
    assert.ok(workflowBodies.every((body) => !combined.includes(body.trim())),
        'An ON workflow body leaked into the effective OFF lead prompt');
    return { sessionWorkflowId: 'none', systemMessages: system.length,
        effectiveSystemPromptHash: hash(combined), workflowBodyPresent: false,
        checkedWorkflowBodyHashes: workflowBodies.map((body) => hash(body.trim())),
        safetyEnvelopePresent: true };
}

export function readLedger(data) {
    const db = new DatabaseSync(join(data, 'usage', 'ledger.sqlite'), { readOnly: true });
    try {
        // 원장 input은 비캐시 부분이다. OAuth의 원래 inclusive 입력을 여기서 한 번 복원한다.
        return db.prepare(`SELECT lower(hex(e.id)) AS id, e.ts, s.value AS sessionId,
            json_extract(r.signature,'$[0]') AS provider, json_extract(r.signature,'$[1]') AS model,
            json_extract(r.signature,'$[3]') AS sourceType, json_extract(r.signature,'$[9]') AS effort,
            json_extract(r.signature,'$[10]') AS agent, json_extract(r.signature,'$[11]') AS fast,
            e.input + e.cache_read + e.cache_write AS input, e.cache_read AS cachedInput,
            e.input + e.cache_write AS noncachedInput,
            e.cache_write AS cacheWrite, e.output AS output, e.duration_ms AS durationMs,
            json_extract(r.signature,'$[5].inputTokensKnown') AS inputTokensKnown
            FROM usage_events e JOIN usage_routes r ON e.route=r.id
            JOIN usage_sessions s ON e.session=s.id ORDER BY e.ts,e.id`).all().map((row) => ({ ...row }));
    } finally { db.close(); }
}

export const receipt = (path) => ({ path: resolve(path), sha256: hash(readFileSync(path)) });

export function verifyReceipts(receipts) {
    for (const item of receipts) assert.equal(hash(readFileSync(item.path)), item.sha256,
        `Immutable evidence changed: ${item.path}`);
}

function runtimeFingerprint(root) {
    const entries = [];
    const visit = (path) => {
        for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = join(path, entry.name);
            if (entry.isDirectory()) visit(child);
            else entries.push([child, hash(readFileSync(join(root, child)))]);
        }
    };
    for (const path of ['engine/src', 'engine/bin', 'plugin/server', 'plugin/shared', 'patches']) visit(path);
    entries.push(['scripts/patch-mixdog.mjs', hash(readFileSync(join(root, 'scripts/patch-mixdog.mjs')))]);
    return hash(JSON.stringify(entries));
}

export function priorState(directory) {
    const manifestPath = join(directory, 'experiment.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    verifyReceipts(manifest.priorReceipts || []);
    for (const sample of manifest.reused || []) verifyReceipts(sample.receipts);
    for (const run of manifest.runs) {
        if (run.result) verifyReceipts([run.result]);
        if (run.supervision) verifyReceipts([run.supervision]);
    }
    if (manifest.continuation) verifyReceipts([manifest.continuation]);
    const parent = manifest.priorExperiment ? priorState(manifest.priorExperiment) : { receipts: [], starts: 0 };
    const receipts = [...parent.receipts, receipt(manifestPath)];
    for (const run of manifest.runs) {
        for (const file of ['run.json', 'result.json', 'events.jsonl', 'supervision.json']) {
            const path = join(run.directory, file);
            if (existsSync(path)) receipts.push(receipt(path));
        }
    }
    const evidence = join(directory, 'evidence.json');
    if (existsSync(evidence)) {
        receipts.push(receipt(evidence));
        const summary = JSON.parse(readFileSync(evidence, 'utf8'));
        if (summary.initialSetupFailure?.path) receipts.push(receipt(summary.initialSetupFailure.path));
    }
    const stopped = join(directory, 'stop.json');
    const blocked = existsSync(stopped) ? JSON.parse(readFileSync(stopped, 'utf8')) : parent.blocked;
    if (existsSync(stopped)) receipts.push(receipt(stopped));
    const audit = join(directory, 'audit.json');
    if (existsSync(audit)) receipts.push(receipt(audit));
    const final = join(directory, 'final-evidence.json');
    if (existsSync(final)) receipts.push(receipt(final));
    return { receipts, starts: Math.max(parent.starts, manifest.spentLeadRuns || 0) + manifest.runs.length, manifest, blocked };
}

export function verifySample(reference, experiment) {
    verifyReceipts(reference.receipts);
    const result = JSON.parse(readFileSync(reference.result.path, 'utf8'));
    const run = JSON.parse(readFileSync(reference.run.path, 'utf8'));
    assert.equal(result.status, 'PASS');
    assert.equal(result.oracle?.pass, true);
    assert.equal(result.usageValid, true);
    assert.equal(result.variant, 'baseline', 'Only valid baseline samples may satisfy a reviewed continuation');
    assertCompletedJobs(result.children || [], result.leadId);
    assert.equal(run.experiment.fixtureHash, experiment.fixtureHash);
    assert.equal(run.experiment.baselineWorkflowHash, experiment.baselineWorkflowHash);
    assert.equal(run.experiment.revision, experiment.revision);
    assert.deepEqual(result.route, route);
    assert.equal(runtimeFingerprint(run.experiment.staged), runtimeFingerprint(experiment.staged),
        'Runtime source changed; cannot reuse the prior sample');
    const session = JSON.parse(readFileSync(join(run.directory, 'home/mixdog/data/sessions', result.leadId + '.json'), 'utf8'));
    assert.ok(session.messages.some((message) => message.role === 'system' && message.content === envelope),
        'Safety envelope differs from the reusable sample');
    assert.equal(session.workflow?.id, 'benchmark-baseline');
    return result;
}

export function continuationBudget(experiment, starts) {
    assert.ok(Number.isInteger(starts) && starts > 0);
    const remaining = experiment.maximumLeadRuns - experiment.spentLeadRuns - experiment.runs.length;
    assert.ok(starts <= remaining, `Lead-run budget exhausted; ${remaining} starts remain`);
    return remaining;
}

export function validatePlan(experiment, variant, tasks, reviewed) {
    assert.ok(!experiment.blocked, 'Experiment stopped by an immutable failure audit');
    const large = reviewed?.kind === 'large-comparison';
    const off = reviewed?.kind === 'workflow-off';
    if (!large && !off) assert.ok(experiment.runs.every((run) => run.status === 'PASS'), 'Experiment stopped after a failed/uncertain run');
    else assert.ok(experiment.runs.every((run) => run.status !== 'STARTED'), 'An earlier run is still uncertain');
    assert.ok(['baseline', 'candidate1', 'candidate2', 'off'].includes(variant), 'Unknown variant');
    assert.ok(tasks.length && new Set(tasks).size === tasks.length && tasks.every((task) => taskFixtures[task]), 'Invalid tasks');
    const samples = [...(experiment.reused || []), ...experiment.runs];
    assert.ok(!tasks.some((task) => samples.some((sample) => sample.variant === variant && sample.task === task)),
        'Never replay an unchanged valid sample');
    continuationBudget(experiment, tasks.length);
    if (off) {
        assert.equal(variant, 'off', 'This review authorizes only new workflow-OFF cases');
        assert.equal(experiment.spentLeadRuns, 11);
        assert.equal(reviewed.spentLeadRuns, 11);
        assert.equal(experiment.maximumLeadRuns, 14);
        assert.equal(reviewed.maximumLeadRuns, 14);
        assert.deepEqual(reviewed.tasks, ['localized', 'multipart', 'large']);
        assert.deepEqual(tasks, [reviewed.tasks[experiment.runs.length]], 'Only the next new OFF task is authorized');
        assert.equal(experiment.fixtureHash, reviewed.fixtureHash);
        assert.equal(experiment.largeFixtureHash, reviewed.largeFixtureHash);
        return;
    }
    assert.notEqual(variant, 'off', 'Workflow OFF requires its explicitly reviewed continuation');
    if (large) {
        assert.equal(experiment.spentLeadRuns, 8);
        assert.equal(reviewed.spentLeadRuns, 8);
        assert.equal(experiment.maximumLeadRuns, 11);
        assert.equal(reviewed.maximumLeadRuns, 11);
        assert.deepEqual(tasks, ['large']);
        assert.deepEqual(reviewed.variants, ['baseline', 'candidate1', 'candidate2']);
        assert.equal(variant, reviewed.variants[experiment.runs.length], 'Only the next new workflow comparison is authorized');
        assert.equal(experiment.largeFixtureHash, reviewed.fixtureHash);
        return;
    }
    if (reviewed) {
        assert.equal(reviewed.candidate, 'candidate2');
        assert.equal(variant, reviewed.candidate, 'Only the explicitly reviewed changed candidate is authorized');
        assert.equal(experiment.spentLeadRuns, 6);
        assert.equal(reviewed.spentLeadRuns, 6);
        assert.equal(experiment.maximumLeadRuns, 8);
        assert.equal(reviewed.maximumLeadRuns, 8);
        assert.deepEqual(reviewed.tasks, Object.keys(fixtures));
    }
    if (variant !== 'baseline') assert.ok(Object.keys(fixtures).every((task) =>
        samples.some((sample) => sample.task === task && sample.variant ===
            (reviewed || variant === 'candidate1' ? 'baseline' : 'candidate1'))), 'Measure both preceding tasks successfully first');
}

export function reviewedContinuation(prior, candidate, workflowPath) {
    assert.equal(candidate, 'candidate2', 'This review authorizes candidate2 only');
    assert.equal(prior.starts, 6, 'The reviewed continuation starts with exactly six spent starts');
    assert.ok(prior.blocked?.quarantinedResult, 'A reviewed continuation must retain the prior quarantine');
    verifyReceipts(prior.receipts);
    const directory = prior.manifest.directory;
    const audit = JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8'));
    assert.equal(audit.remainingLiveLeadStarts, 2);
    assert.equal(audit.status, 'BLOCKED');
    const accepted = audit.candidates.find((item) => item.path.endsWith('workflow-token-benchmark-candidate2.md'));
    const workflow = receipt(workflowPath);
    assert.equal(workflow.sha256, accepted?.sha256, 'The reviewed candidate guidance changed');
    return { schema: 1, candidate, tasks: Object.keys(fixtures), spentLeadRuns: 6, maximumLeadRuns: 8,
        workflow, sourceStop: receipt(join(directory, 'stop.json')), sourceAudit: receipt(join(directory, 'audit.json')),
        quarantinedResult: prior.blocked.quarantinedResult,
        authorization: 'Lead explicitly authorized two NEW candidate2 tasks addressing the model-issued premature close; baseline comparison only; no retries or candidate1 replay' };
}

export function largeContinuation(prior, candidatePaths) {
    assert.equal(prior.starts, 8, 'The larger comparison starts with exactly eight spent starts');
    verifyReceipts(prior.receipts);
    const finalPath = join(prior.manifest.directory, 'final-evidence.json');
    const final = JSON.parse(readFileSync(finalPath, 'utf8'));
    assert.equal(final.status, 'DONE');
    assert.equal(final.remainingLiveLeadStarts, 0);
    const workflows = { baseline: receipt(join(prior.manifest.directory, 'baseline.WORKFLOW.md')) };
    assert.equal(workflows.baseline.sha256, prior.manifest.baselineWorkflowHash);
    for (const [index, candidate] of ['candidate1', 'candidate2'].entries()) {
        workflows[candidate] = receipt(candidatePaths[index]);
        const accepted = final.ownedFiles.find((item) => item.path.endsWith(`workflow-token-benchmark-${candidate}.md`));
        assert.equal(workflows[candidate].sha256, accepted?.sha256, 'Existing workflows must remain unchanged for the size comparison');
    }
    return { schema: 1, kind: 'large-comparison', tasks: ['large'],
        variants: ['baseline', 'candidate1', 'candidate2'], spentLeadRuns: 8, maximumLeadRuns: 11,
        fixtureHash: hash(JSON.stringify(largeFixture)), workflows,
        receipts: [receipt(finalPath), ...Object.values(workflows)],
        authorization: 'Lead explicitly authorized only three NEW large-fixture runs, one per unchanged workflow; earlier failed samples remain failures and do not prohibit a different workflow; no retry or session replay' };
}

export function offContinuation(prior, candidatePaths, staged) {
    assert.equal(prior.starts, 11, 'The OFF comparison starts with exactly eleven spent starts');
    verifyReceipts(prior.receipts);
    const finalPath = join(prior.manifest.directory, 'final-evidence.json');
    const final = JSON.parse(readFileSync(finalPath, 'utf8'));
    assert.equal(final.status, 'DONE');
    assert.equal(final.cumulative.remainingLiveLeadStarts, 0);
    assert.deepEqual(final.route, route);
    assert.equal(prior.manifest.fixtureHash, hash(JSON.stringify(fixtures)), 'Small task inputs or oracles changed');
    assert.equal(prior.manifest.largeFixtureHash, hash(JSON.stringify(largeFixture)), 'Large task inputs or oracle changed');
    assert.equal(runtimeFingerprint(prior.manifest.staged), runtimeFingerprint(staged), 'Native runtime source changed');
    const workflows = { baseline: receipt(join(prior.manifest.directory, 'baseline.WORKFLOW.md')) };
    assert.equal(workflows.baseline.sha256, prior.manifest.baselineWorkflowHash);
    for (const [index, candidate] of ['candidate1', 'candidate2'].entries()) {
        workflows[candidate] = receipt(candidatePaths[index]);
        const accepted = final.ownedFiles.find((item) => item.path.endsWith(`workflow-token-benchmark-${candidate}.md`));
        assert.equal(workflows[candidate].sha256, accepted?.sha256, 'The ON workflow bodies changed');
    }
    const matching = ['localized', 'multipart', 'large'].map((task) => {
        const record = final.records.find((item) => item.task === task && item.variant === 'baseline' && item.measurementValid);
        assert.ok(record, `A valid matching default-ON sample is required for ${task}`);
        verifyReceipts([record.resultReceipt, record.rawRunReceipt]);
        return { task, result: record.resultReceipt, run: record.rawRunReceipt };
    });
    return { schema: 1, kind: 'workflow-off', tasks: ['localized', 'multipart', 'large'],
        spentLeadRuns: 11, maximumLeadRuns: 14, fixtureHash: prior.manifest.fixtureHash,
        largeFixtureHash: prior.manifest.largeFixtureHash, workflows, matchingDefaultOn: matching,
        receipts: [receipt(finalPath), ...Object.values(workflows), ...matching.flatMap((item) => [item.result, item.run])],
        authorization: 'Lead explicitly authorized exactly one NEW native workflow=none run per unchanged task; orchestration remains swarm, Worker permissions/routes and all safety limits remain identical; no retries or canceled-session replay' };
}

export async function superviseRun({ launch, engineScope, credentials, deadlineMs, spawnProcess = spawn,
    stopGroup = stopEngineProcessGroup }) {
    let child, timer, stopping;
    const result = { exitCode: null, signal: null, timedOut: false, errors: [],
        cleanup: { engineScopeStopped: false, runnerGroupStopped: false, credentialsRemoved: false } };
    const stop = () => stopping ??= (async () => {
        try { await engineScope.stop(); result.cleanup.engineScopeStopped = true; }
        catch (error) { result.errors.push(error.message); }
        try {
            if (child) await stopGroup(child, (process) => process.kill('SIGKILL'));
            result.cleanup.runnerGroupStopped = true;
        } catch (error) { result.errors.push(error.message); }
    })();
    try {
        timer = setTimeout(() => { result.timedOut = true; void stop(); }, deadlineMs);
        await engineScope.preflight();
        assert.ok(!result.timedOut, 'Run deadline exhausted during containment preflight');
        child = spawnProcess(launch.command, launch.args, { env: launch.env, cwd: launch.cwd,
            stdio: ['ignore', 'inherit', 'inherit'], detached: process.platform !== 'win32' });
        await new Promise((done) => {
            child.once('error', (error) => { result.errors.push(error.message); done(); });
            child.once('close', (code, signal) => { result.exitCode = code; result.signal = signal; done(); });
        });
    } catch (error) { result.errors.push(error.message); }
    finally {
        clearTimeout(timer);
        await stop();
        rmSync(credentials, { force: true });
        result.cleanup.credentialsRemoved = !existsSync(credentials);
    }
    return result;
}

export function prepare(dependencyRoot, revision, priorExperiment, maximumLeadRuns = 6, reusePass, reviewedCandidate, workflowPath, largeComparison = false, offComparison = false) {
    assert.ok(supportedNode(), 'Use a supported Node runtime');
    dependencyRoot = realpathSync(dependencyRoot);
    assert.ok(existsSync(join(dependencyRoot, 'src/mixdog-session-runtime.mjs')), 'Native entry missing');
    const gate = patch(dependencyRoot, { check: true });
    const directory = mkdtempSync(join(scratchRoot, 'paseodog-workflow-tokens-'));
    const staged = join(directory, 'source');
    mkdirSync(staged);
    for (const path of ['engine/src', 'engine/bin', 'plugin/server', 'plugin/shared', 'scripts', 'patches',
        'tests/fixtures/workflow-token-benchmark.mjs', 'tests/fixtures/workflow-token-large.mjs', 'tests/fixtures/workflow-large']) {
        cpSync(join(sourceRoot, path), join(staged, path), { recursive: true });
    }
    symlinkSync(dirname(dependencyRoot), join(staged, 'engine/node_modules'), 'dir');
    const workflow = readFileSync(join(dependencyRoot, 'src/workflows/default/WORKFLOW.md'), 'utf8');
    writeFileSync(join(directory, 'baseline.WORKFLOW.md'), workflow);
    const prior = priorExperiment ? priorState(priorExperiment) : null;
    const reviewed = offComparison ? offContinuation(prior, ['candidate1', 'candidate2'].map((candidate) =>
        join(sourceRoot, `tests/fixtures/workflow-token-benchmark-${candidate}.md`)), staged)
        : largeComparison ? largeContinuation(prior, ['candidate1', 'candidate2'].map((candidate) =>
        join(sourceRoot, `tests/fixtures/workflow-token-benchmark-${candidate}.md`)))
        : reviewedCandidate ? reviewedContinuation(prior, reviewedCandidate, workflowPath) : null;
    assert.ok(!prior?.blocked || reviewed, 'Prior experiment stopped by a new failure; fresh authorization is required');
    const spentLeadRuns = prior?.starts || 0;
    const manifest = {
        schema: 1, directory, sourceRoot, staged, revision, dependencyRoot, gate, route,
        baselineWorkflowHash: hash(workflow), createdAt: new Date().toISOString(),
        maximumLeadRuns, maximumWorkersPerRun: 2, deadlineMs: 600000,
        fixtureHash: hash(JSON.stringify(fixtures)), runs: [], spentLeadRuns,
        priorExperiment: priorExperiment || null, priorReceipts: prior?.receipts || [], reused: [],
    };
    if (largeComparison || offComparison) manifest.largeFixtureHash = hash(JSON.stringify(largeFixture));
    for (const path of typeof reusePass === 'string' ? [reusePass] : reusePass || []) {
        const location = dirname(resolve(path));
        assert.ok(prior?.receipts.some((item) => item.path === resolve(path)), 'Reuse must come from the referenced prior evidence');
        const reference = { result: receipt(path), run: receipt(join(location, 'run.json')),
            receipts: ['result.json', 'run.json', 'events.jsonl'].map((name) => receipt(join(location, name))) };
        const result = verifySample(reference, manifest);
        reference.variant = result.variant;
        reference.task = result.task;
        manifest.reused.push(reference);
    }
    if (reviewed) {
        validatePlan(manifest, reviewed.kind === 'workflow-off' ? 'off'
            : reviewed.kind === 'large-comparison' ? 'baseline' : reviewed.candidate,
        reviewed.kind === 'workflow-off' ? ['localized'] : reviewed.tasks, reviewed);
        save(join(directory, 'continuation.json'), reviewed);
        manifest.continuation = receipt(join(directory, 'continuation.json'));
    }
    save(join(directory, 'experiment.json'), manifest);
    return directory;
}

async function executeRun(manifestPath) {
    const run = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const reservation = JSON.parse(readFileSync(join(run.experiment.directory, 'experiment.json'), 'utf8')).runs
        .find((item) => item.directory === run.directory);
    assert.equal(reservation?.status, 'STARTED', 'Internal invocation requires a reserved start');
    assert.equal(reservation.runHash, hash(readFileSync(manifestPath)), 'Reserved invocation changed');
    assert.ok(typeof run.invocation === 'string' && process.env.PASEODOG_BENCHMARK_INVOCATION === run.invocation,
        'Internal invocation is not parent-authorized');
    assert.match(run.engineUnit, /^paseodog-[0-9a-f]{32}\.scope$/);
    assert.equal(process.env.MIXDOG_DATA_DIR, join(run.directory, 'home/mixdog/data'));
    assert.equal(process.env.OPENAI_OAUTH_CREDENTIALS_PATH, join(run.directory, 'home/mixdog/data/benchmark-oauth.json'));
    writeFileSync(join(run.directory, 'started.json'), JSON.stringify({ at: new Date().toISOString(), invocation: run.invocation }),
        { flag: 'wx', mode: 0o600 });
    const started = performance.now();
    const data = process.env.MIXDOG_DATA_DIR;
    const dependencyRoot = run.experiment.dependencyRoot;
    const imported = (path) => import(pathToFileURL(join(dependencyRoot, 'src', path)).href);
    // default 선택은 upstream 저장 경로에서 삭제되어 none으로 바뀐다.
    // 본문은 그대로 두고 모든 조건에 동일한 사용자 pack 저장 경로를 사용한다.
    const workflowId = run.variant === 'off' ? 'none' : `benchmark-${run.variant}`;
    const callbacksFile = join(run.directory, 'events.jsonl');
    const events = [];
    const emit = (type, detail) => {
        const event = { elapsedMs: Math.round(performance.now() - started), type, ...detail };
        events.push(event);
        // 허용된 고정 fixture 데이터만 기록하고 원시 stderr/설정/인증은 기록하지 않는다.
        writeFileSync(callbacksFile, JSON.stringify(event) + '\n', { flag: 'a', mode: 0o600 });
    };
    const env = { ...process.env };
    const factory = processEngineFactory({
        launch: { command: process.execPath, args: [join(run.experiment.staged, 'engine/bin/paseodog-engine.mjs')], env },
        spawnProcess: (command, args, options) => spawn(command, args, options),
        terminateProcess: (child) => child.kill('SIGKILL'),
        scopeFactory: (options) => createProcessScope({ ...options, unitName: run.engineUnit }),
    });
    let engine, leadId, timer, executionStart, abortPromise, offBodies;
    const deltas = [];
    let denied = false;
    const result = { variant: run.variant, task: run.task, revision: run.experiment.revision,
        route, workflow: { id: workflowId, hash: null }, errors: [], aborted: false,
        timing: { setupMs: null, queueMs: run.queueMs, executionMs: null, providerQueueMs: null } };
    try {
        const { loadTokens, TOKEN_REFRESH_SKEW_MS } = await imported('runtime/agent/orchestrator/providers/openai-oauth-tokens.mjs');
        const tokens = loadTokens();
        assert.ok(tokens?.expires_at > Date.now() + run.experiment.deadlineMs + TOKEN_REFRESH_SKEW_MS,
            'Authentication missing or too near refresh; do not refresh a copied subscription credential');
        const { updateSection } = await imported('runtime/shared/config.mjs');
        const { readMarkdownDocument } = await imported('runtime/shared/markdown-frontmatter.mjs');
        const body = readMarkdownDocument(run.workflowBody).body;
        if (run.variant === 'off') offBodies = run.workflowSources.map((text) => readMarkdownDocument(text).body);
        result.workflow.hash = hash(body);
        if (run.variant !== 'off') {
            const workflowDir = join(data, 'workflows', workflowId);
            mkdirSync(workflowDir, { recursive: true });
            writeFileSync(join(workflowDir, 'WORKFLOW.md'),
                `---\nid: ${workflowId}\nname: ${workflowId}\n---\n\n${body}\n`);
        }
        updateSection('agent', () => ({
            providers: { 'openai-oauth': { enabled: true, preconnect: false } },
            presets: [{ id: 'benchmark', name: 'Benchmark', ...route, tools: 'full' }], default: 'benchmark',
            agents: { worker: { ...route } }, enabledAgents: ['worker'],
            workflow: { active: workflowId }, orchestrationMode: 'swarm',
            builtins: { autoEffort: false }, update: { auto: false }, aiSessionTitles: false,
            heartbeat: false, recap: false, promptCacheWarming: false,
            memory: false, modules: { memory: { enabled: false } }, mcpServers: {},
            instructionFiles: 'off',
        }));
        engine = await factory.create({ config: { cwd: run.work, mode: 'ask', env: {},
            systemPrompt: envelope, mcpServers: {}, settings: { effort: 'xhigh', autoEffort: false }, persist: true }, route });
        result.initialStatus = await engine.status();
        assert.equal(result.initialStatus.workflow?.id, workflowId, 'Workflow is not genuinely active');
        assert.equal(result.initialStatus.orchestration, 'swarm');
        executionStart = performance.now();
        result.timing.setupMs = Math.round(executionStart - started);
        const approve = createApprovalPolicy(run.work);
        const abort = (reason) => {
            if (abortPromise) return abortPromise;
            result.aborted = true;
            emit('abort', { reason });
            abortPromise = engine.abort(reason).catch((error) => {
                result.errors.push({ message: error.message });
            });
            return abortPromise;
        };
        const remaining = run.deadlineAt - Date.now();
        assert.ok(remaining > 0, 'Ten-minute run budget exhausted during setup');
        timer = setTimeout(() => { void abort('Ten-minute run budget exhausted'); }, remaining);
        const answer = await engine.ask(taskFixtures[run.task].prompt, {
            onIdentity: (identity) => {
                leadId = identity.id;
                emit('identity', identity);
                assert.equal(identity.state.provider, route.provider);
                assert.equal(identity.state.model, route.model);
                assert.equal(identity.state.effort, route.effort);
            },
            onToolApproval: async (info) => {
                const decision = approve(info);
                emit('approval', { name: info.name, args: info.args, childSessionId: info.childSessionId || null,
                    approved: decision.approved, reason: decision.reason || null });
                if (!decision.approved) { denied = true; void abort('Benchmark policy denied a tool; measurement invalid'); }
                return decision;
            },
            onUsageDelta: (delta) => {
                const keys = ['sessionId', 'iterationIndex', 'source', 'requestedModel', 'model', 'ts',
                    'deltaInput', 'deltaCachedRead', 'deltaOutput', 'reasoningTokens', 'reasoningTokensComplete',
                    'requestMs', 'promptKnown'];
                const safe = Object.fromEntries(keys.filter((key) => delta[key] !== undefined).map((key) => [key, delta[key]]));
                deltas.push(safe);
                emit('usage', safe);
            },
            onToolCall: (iteration, calls) => emit('tools', { iteration, calls }),
        });
        result.timing.executionMs = Math.round(performance.now() - executionStart);
        result.answer = answer.result?.content || '';
        result.oracle = evaluateAnswer(run.task, result.answer);
        result.finalStatus = await engine.status();
        result.leadId = leadId;
        result.children = result.finalStatus.jobs;
        assertCompletedJobs(result.children, leadId);
        assert.equal(result.finalStatus.fast, false);
        assert.equal(result.finalStatus.autoEffort, false);
        assert.equal(result.finalStatus.workflow?.id, workflowId);
        assert.equal(result.finalStatus.orchestration, 'swarm');
        assert.ok(!denied && !result.aborted, 'Aborted or denied run is not valid evidence');
    } catch (error) {
        result.errors.push({ name: error.name, message: String(error.message).replace(/(?:Bearer\s+)?eyJ[\w.-]+/g, '[redacted]'),
            quota: Boolean(error.quota) });
        result.timing.executionMs = executionStart ? Math.round(performance.now() - executionStart) : null;
    } finally {
        clearTimeout(timer);
        result.leadId = leadId || null;
        await abortPromise;
        if (engine && !result.finalStatus) {
            try {
                result.finalStatus = await engine.status();
                result.children = result.finalStatus.jobs;
            } catch (error) { result.errors.push({ message: `Final status unavailable: ${error.message}` }); }
        }
        try { await engine?.close(); } catch (error) { result.errors.push({ message: error.message }); }
        // 비밀 복사본은 유지하지 않는다. 원본 인증 파일은 절대 쓰지 않는다.
        rmSync(process.env.OPENAI_OAUTH_CREDENTIALS_PATH, { force: true });
    }
    const ledger = join(data, 'usage/ledger.sqlite');
    if (run.variant === 'off' && leadId) {
        try {
            const session = JSON.parse(readFileSync(join(data, 'sessions', leadId + '.json'), 'utf8'));
            result.leadPromptVerification = verifyOffPrompt(session, offBodies || []);
        } catch (error) { result.errors.push({ message: `OFF prompt verification failed: ${error.message}` }); }
    }
    result.requests = [];
    try { if (existsSync(ledger)) result.requests = readLedger(data); }
    catch (error) { result.errors.push({ message: `Ledger unavailable: ${error.message}` }); }
    result.usage = summarizeUsage(result.requests, deltas, leadId);
    result.childCount = new Set(result.requests.filter((row) => row.sessionId !== leadId).map((row) => row.sessionId)).size;
    // 중단된 마지막 요청에는 아직 보고되지 않은 사용량이 있을 수 있다.
    result.usageValid = !result.aborted && !result.errors.length && result.requests.length > 0 && result.requests.every((row) =>
        row.provider === route.provider && row.model === route.model && row.effort === route.effort
        && row.fast === 0 && row.inputTokensKnown !== 0)
        && deltas.every((delta) => delta.promptKnown === true)
        && result.requests.length === deltas.length
        && result.requests.reduce((n, row) => n + row.input, 0) === deltas.reduce((n, row) => n + row.deltaInput, 0)
        && result.requests.reduce((n, row) => n + row.cachedInput, 0)
            === deltas.reduce((n, row) => n + row.deltaCachedRead, 0)
        && result.requests.reduce((n, row) => n + row.output, 0) === deltas.reduce((n, row) => n + row.deltaOutput, 0);
    result.totalRequests = result.usageValid ? result.requests.length : null;
    result.status = result.errors.length || result.aborted || !result.oracle?.pass || !result.usageValid ? 'FAIL' : 'PASS';
    save(join(run.directory, 'result.json'), result);
    console.log(JSON.stringify({ variant: run.variant, task: run.task, status: result.status,
        usage: result.usage, childCount: result.childCount, oracle: result.oracle?.pass,
        errors: result.errors, directory: run.directory }));
    return result.status === 'PASS' ? 0 : 1;
}

async function runVariant(directory, variant, workflowPath, queueMs, tasks) {
    const manifestPath = join(directory, 'experiment.json');
    const experiment = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const stopped = join(directory, 'stop.json');
    if (existsSync(stopped)) experiment.blocked = JSON.parse(readFileSync(stopped, 'utf8'));
    verifyReceipts(experiment.priorReceipts || []);
    for (const reference of experiment.reused || []) verifySample(reference, experiment);
    for (const sample of experiment.runs) {
        if (sample.result) verifyReceipts([sample.result]);
        if (sample.supervision) verifyReceipts([sample.supervision]);
    }
    let reviewed;
    if (experiment.continuation) {
        verifyReceipts([experiment.continuation]);
        reviewed = JSON.parse(readFileSync(experiment.continuation.path, 'utf8'));
        verifyReceipts(['large-comparison', 'workflow-off'].includes(reviewed.kind) ? reviewed.receipts
            : [reviewed.sourceStop, reviewed.sourceAudit, reviewed.quarantinedResult, reviewed.workflow]);
    }
    validatePlan(experiment, variant, tasks, reviewed);
    const workflowBody = variant === 'off' ? '' : variant === 'baseline'
        ? readFileSync(join(directory, 'baseline.WORKFLOW.md'), 'utf8')
        : readFileSync(workflowPath, 'utf8');
    if (reviewed && reviewed.kind !== 'workflow-off') assert.equal(hash(workflowBody), (reviewed.kind === 'large-comparison'
        ? reviewed.workflows[variant] : reviewed.workflow).sha256, 'The reviewed candidate guidance changed');
    if (reviewed?.kind === 'large-comparison') assert.equal(hash(JSON.stringify(largeFixture)), reviewed.fixtureHash,
        'The larger fixture or its oracle changed between measured workflows');
    if (reviewed?.kind === 'workflow-off') {
        assert.equal(hash(JSON.stringify(fixtures)), reviewed.fixtureHash);
        assert.equal(hash(JSON.stringify(largeFixture)), reviewed.largeFixtureHash);
    }
    if (variant !== 'baseline' && variant !== 'off') {
        const { readMarkdownDocument } = await import(pathToFileURL(join(experiment.dependencyRoot,
            'src/runtime/shared/markdown-frontmatter.mjs')).href);
        const baseline = readMarkdownDocument(readFileSync(join(directory, 'baseline.WORKFLOW.md'), 'utf8')).body.trim();
        assert.ok(readMarkdownDocument(workflowBody).body.trim().startsWith(baseline),
            'Candidates must preserve the baseline authorization policy verbatim');
    }
    const original = runtimeEnv();
    assert.ok(original.OPENAI_OAUTH_CREDENTIALS_PATH, 'Existing supported credential route is required');
    for (const task of tasks) {
        const runDirectory = join(directory, `${variant}-${task}`);
        mkdirSync(runDirectory);
        const work = join(runDirectory, 'work');
        const home = join(runDirectory, 'home');
        const data = join(home, 'mixdog/data');
        mkdirSync(work);
        mkdirSync(data, { recursive: true });
        for (const [path, content] of Object.entries(taskFixtures[task].files))
            writeFileSync(join(work, path), content, { mode: 0o444 });
        const credentials = join(data, 'benchmark-oauth.json');
        const engineUnit = `paseodog-${randomUUID().replaceAll('-', '')}.scope`;
        const invocation = randomUUID();
        const run = { directory: runDirectory, work, variant, task, workflowBody, experiment, queueMs,
            deadlineAt: Date.now() + experiment.deadlineMs, engineUnit, invocation };
        if (variant === 'off') run.workflowSources = Object.values(reviewed.workflows)
            .map((item) => readFileSync(item.path, 'utf8'));
        const path = join(runDirectory, 'run.json');
        save(path, run);
        experiment.runs.push({ variant, task, directory: runDirectory, status: 'STARTED', runHash: hash(readFileSync(path)) });
        save(manifestPath, experiment);
        const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR',
            'TMPDIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
        Object.assign(env, { HOME: home, MIXDOG_HOME: join(home, 'mixdog'), MIXDOG_DATA_DIR: data,
            PASEO_HOME: join(home, 'paseo'), PASEODOG_STATE_DIR: join(home, 'journal'),
            OPENAI_OAUTH_CREDENTIALS_PATH: credentials, PASEODOG_TEST_PARENT_WORKER: 'true',
            PASEODOG_BENCHMARK_INVOCATION: invocation });
        const engineLaunch = { command: process.execPath,
            args: [join(experiment.staged, 'engine/bin/paseodog-engine.mjs')], env };
        let supervision;
        try {
            copyFileSync(original.OPENAI_OAUTH_CREDENTIALS_PATH, credentials);
            chmodSync(credentials, 0o600);
            supervision = await superviseRun({
                launch: { command: process.execPath, args: [fileURLToPath(import.meta.url),
                    '--execute-run', path, '--confirm-api-use'], env, cwd: work },
                engineScope: createProcessScope({ launch: engineLaunch, unitName: engineUnit }),
                credentials, deadlineMs: Math.max(1, run.deadlineAt - Date.now()),
            });
        } catch (error) {
            rmSync(credentials, { force: true });
            supervision = { errors: [error.message], exitCode: null, startupFailure: true,
                cleanup: { credentialsRemoved: !existsSync(credentials) } };
        }
        save(join(runDirectory, 'supervision.json'), { ...supervision, engineUnit });
        const resultPath = join(runDirectory, 'result.json');
        if (!existsSync(resultPath)) {
            const ledger = join(data, 'usage/ledger.sqlite');
            save(resultPath, { variant, task, status: 'FAIL', aborted: supervision.timedOut === true,
                errors: supervision.errors, totalRequests: null,
                requests: existsSync(ledger) ? readLedger(data) : [], usageValid: false,
                failure: 'Runner did not produce a completed result; recorded usage may be partial' });
        }
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));
        const pass = supervision.exitCode === 0 && !supervision.timedOut
            && !supervision.errors.length && result.status === 'PASS';
        experiment.runs.at(-1).status = pass ? 'PASS' : 'FAIL';
        experiment.runs.at(-1).result = receipt(resultPath);
        experiment.runs.at(-1).supervision = receipt(join(runDirectory, 'supervision.json'));
        save(manifestPath, experiment);
        if (!pass) throw new Error(`Stopped after ${variant}/${task}; ${experiment.maximumLeadRuns
            - experiment.spentLeadRuns - experiment.runs.length} starts remain; inspect result.json and supervision.json`);
    }
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({ args, options: {
        prepare: { type: 'boolean' }, 'dependency-root': { type: 'string' }, revision: { type: 'string' },
        run: { type: 'string' }, experiment: { type: 'string' }, workflow: { type: 'string' },
        tasks: { type: 'string' }, 'prior-experiment': { type: 'string' },
        'maximum-lead-runs': { type: 'string' }, 'reuse-pass': { type: 'string', multiple: true },
        'reviewed-candidate': { type: 'string' },
        'large-comparison': { type: 'boolean' },
        'off-comparison': { type: 'boolean' },
        'confirm-api-use': { type: 'boolean' }, 'execute-run': { type: 'string' },
    } });
    if (values.prepare) {
        assert.ok(values['dependency-root'] && values.revision, 'Preparation requires dependency root and revision');
        const maximum = Number(values['maximum-lead-runs'] || 6);
        assert.ok(Number.isInteger(maximum) && maximum > 0 && maximum <= 14, 'Authorized envelope is at most fourteen starts');
        assert.ok(!(values['large-comparison'] && values['off-comparison']), 'Choose one explicitly reviewed continuation');
        if (maximum > 11) assert.ok(maximum === 14 && values['off-comparison'],
            'Only the three explicitly authorized workflow-OFF tasks may expand the envelope');
        else if (maximum > 8) assert.ok(maximum === 11 && values['large-comparison'],
            'Only the explicitly authorized three-run larger comparison may expand the envelope');
        if (values['large-comparison']) assert.equal(maximum, 11, 'The larger comparison has a cumulative cap of eleven');
        if (values['off-comparison']) assert.equal(maximum, 14, 'The OFF comparison has a cumulative cap of fourteen');
        if (maximum > 6) assert.ok(values['confirm-api-use'] && values['prior-experiment'],
            'An expanded continuation requires explicit confirmation and prior evidence');
        if (values['reviewed-candidate']) assert.ok(values['confirm-api-use'] && values['prior-experiment'] && values.workflow,
            'A reviewed continuation requires explicit confirmation, prior evidence and the accepted workflow');
        console.log(prepare(values['dependency-root'], values.revision, values['prior-experiment'], maximum,
            values['reuse-pass'], values['reviewed-candidate'], values.workflow, values['large-comparison'], values['off-comparison']));
        return 0;
    }
    assert.ok(values['confirm-api-use'], 'Live subscription requests require --confirm-api-use');
    if (values['execute-run']) return executeRun(values['execute-run']);
    assert.ok(values.experiment && values.run, 'Provide --experiment and --run');
    const queuedAt = performance.now();
    await withTestLock(() => runVariant(resolve(values.experiment), values.run, values.workflow,
        Math.round(performance.now() - queuedAt), values.tasks?.split(',') || Object.keys(fixtures)));
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { process.exitCode = await main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
