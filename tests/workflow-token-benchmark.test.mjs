import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { fixtures } from './fixtures/workflow-token-benchmark.mjs';
import { createApprovalPolicy, evaluateAnswer, summarizeUsage, route, main, receipt, verifyReceipts,
    continuationBudget, validatePlan, priorState, superviseRun, assertCompletedJobs, reviewedContinuation,
    verifyOffPrompt, envelope } from '../scripts/workflow-token-benchmark.mjs';
import { createProcessScope } from '../plugin/server/process-scope.mjs';
import { scratchRoot } from '../scripts/paths.mjs';

test('independent fixture oracles require the complete ordered answer', () => {
    for (const [task, fixture] of Object.entries(fixtures)) {
        assert.equal(evaluateAnswer(task, JSON.stringify(fixture.expected)).pass, true);
        assert.equal(evaluateAnswer(task, '```json\n' + JSON.stringify(fixture.expected) + '\n```').pass, true);
        assert.equal(evaluateAnswer(task, '{}').pass, false);
        assert.equal(evaluateAnswer(task, 'done').pass, false);
        const missing = structuredClone(fixture.expected);
        delete missing[Object.keys(missing)[0]];
        assert.equal(evaluateAnswer(task, JSON.stringify(missing)).pass, false);
    }
    // fixture의 자료와 별개로 명시한 경계값·계산값을 검증한다.
    assert.deepEqual(fixtures.localized.expected.accepted.map((row) => row.port), [443, 80, 8080, 65535, 53, 22]);
    assert.equal(fixtures.multipart.expected.checks.billingSum, 1250 - 250 + 333 + 730 + 270 - 125 - 75 + 25);
    assert.equal(fixtures.multipart.expected.checks.inventorySum, 40 + 12 + 0 + 9 - 7 + 2 + 8 - 6 + 15 - 3 - 4 - 1 - 5 + 2 - 1 + 1 + 1);
});

test('approval retains fixture ownership, depth, worker-count and pinned-route boundaries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-policy-'));
    try {
        const work = join(directory, 'work');
        mkdirSync(work);
        symlinkSync(directory, join(work, 'escape'));
        const policy = createApprovalPolicy(work);
        const call = (name, args, extra = {}) => policy({ name, args, cwd: work, ...extra }).approved;
        assert.equal(call('read', { file_path: 'ports.json' }), true);
        assert.equal(call('read', { file_path: [join(work, 'ports.json'), '../secret'] }), false);
        assert.equal(call('read', { file_path: 'escape' }), false);
        assert.equal(call('code_graph', { files: '../secret' }), false);
        assert.equal(call('code_graph', { mode: 'find_symbol', symbols: 'secret', cwd: directory }), false);
        assert.equal(call('code_graph', { mode: 'symbols', files: 'ports.json', cwd: work }), true);
        assert.equal(call('code_graph', { mode: 'symbols', cwd: 'escape' }), false);
        assert.equal(call('shell', { command: 'echo x' }), false);
        assert.equal(call('write', { file_path: 'ports.json' }), false);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker' }, { childSessionId: 'child' }), false);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker', model: 'other' }), false);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker', effort: 'low' }), false);
        assert.equal(call('agent', { type: 'list', global: true }), false);
        assert.equal(call('agent', { type: 'read', task_id: 'owned-result' }), true);
        assert.equal(call('agent', { type: 'wait', task_id: 'owned-result' }), false);
        assert.equal(call('agent', { type: 'send', tag: 'scope', file: '../secret' }), false);
        assert.equal(call('task', { type: 'spawn', agent: 'worker' }), false);
        assert.equal(call('task', { type: 'read', task_id: 'owned-result' }), false);
        assert.equal(call('task', { action: 'read', task_id: 'owned-result' }), true);
        assert.equal(call('task', { action: 'wait', task_id: 'owned-result' }), true);
        assert.equal(call('task', { action: 'cancel', task_id: 'foreign', global: true }), false);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker', ...route }), true);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker' }), true);
        assert.equal(call('agent', { type: 'spawn', agent: 'worker' }), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('accounting adds requests once and keeps cached/reasoning subsets separate', () => {
    const rows = [
        { sessionId: 'lead', input: 100, cachedInput: 60, output: 20, durationMs: 10 },
        { sessionId: 'child', input: 80, cachedInput: 40, output: 10, durationMs: 5 },
    ];
    const deltas = [{ sessionId: 'lead', reasoningTokens: 15, reasoningTokensComplete: true },
        { sessionId: 'child', reasoningTokens: 8, reasoningTokensComplete: true }];
    const result = summarizeUsage(rows, deltas, 'lead');
    assert.equal(result.total.input, 180);
    assert.equal(result.total.cachedInput, 100);
    assert.equal(result.total.noncachedInput, 80);
    assert.equal(result.lead.noncachedInput, 40);
    assert.equal(result.workers.noncachedInput, 40);
    assert.equal(result.total.output, 30);
    assert.equal(result.total.reasoning, 23);
    assert.equal(result.total.requests, 2);
    assert.equal(result.lead.input, 100);
    assert.equal(result.workers.input, 80);
    assert.equal(summarizeUsage(rows, [], 'lead').total.reasoning, null);
});

test('cancelled follow-ups invalidate usage even when the final answer passes; jobs are not worker identities', () => {
    const completed = { sessionId: 'worker', status: 'completed', provider: route.provider,
        model: route.model, effort: route.effort, ownerSessionId: 'lead' };
    assertCompletedJobs([completed, completed, completed], 'lead');
    assert.throws(() => assertCompletedJobs([completed, { ...completed, status: 'cancelled' }], 'lead'), /usage may be unreported/);
    assert.throws(() => assertCompletedJobs([{ ...completed, status: 'failed' }], 'lead'), /usage may be unreported/);
    assert.throws(() => assertCompletedJobs([{ ...completed, ownerSessionId: 'foreign' }], 'lead'), /ownership/);
    assert.throws(() => assertCompletedJobs([completed, { ...completed, sessionId: 'two' },
        { ...completed, sessionId: 'three' }], 'lead'), /Worker budget/);
});

test('billable route requires explicit confirmation', async () => {
    await assert.rejects(main(['--run', 'baseline']), /confirm-api-use/);
    await assert.rejects(main(['--execute-run', '/must-not-be-opened']), /confirm-api-use/);
});

test('OFF requires the native none selection and proves effective prompt body absence without removing the safety envelope', () => {
    const bodies = ['Default workflow policy.', 'Candidate one policy.', 'Candidate two policy.'];
    const session = { workflow: { id: 'none' }, messages: [
        { role: 'system', content: envelope }, { role: 'system', content: 'Native tools remain available.' },
    ] };
    const proof = verifyOffPrompt(session, bodies);
    assert.equal(proof.workflowBodyPresent, false);
    assert.equal(proof.sessionWorkflowId, 'none');
    assert.equal(proof.safetyEnvelopePresent, true);
    assert.throws(() => verifyOffPrompt({ ...session, workflow: { id: 'benchmark-baseline' } }, bodies), /actual native none/);
    assert.throws(() => verifyOffPrompt({ ...session, messages: [...session.messages,
        { role: 'system', content: bodies[0] }] }, bodies), /leaked/);
    assert.throws(() => verifyOffPrompt({ ...session, messages: [] }, bodies), /safety envelope/);
    assert.throws(() => verifyOffPrompt(session, []), /three unchanged ON bodies/);
});

test('OFF continuation allows exactly three fresh ordered cases and retains failed cells without replay', () => {
    const review = { kind: 'workflow-off', tasks: ['localized', 'multipart', 'large'],
        spentLeadRuns: 11, maximumLeadRuns: 14, fixtureHash: 'small', largeFixtureHash: 'large' };
    const experiment = { spentLeadRuns: 11, maximumLeadRuns: 14, fixtureHash: 'small', largeFixtureHash: 'large', runs: [] };
    validatePlan(experiment, 'off', ['localized'], review);
    assert.throws(() => validatePlan(experiment, 'baseline', ['localized'], review), /only new workflow-OFF/);
    assert.throws(() => validatePlan(experiment, 'off', ['large'], review), /next new OFF/);
    experiment.runs.push({ variant: 'off', task: 'localized', status: 'FAIL' });
    validatePlan(experiment, 'off', ['multipart'], review);
    assert.throws(() => validatePlan(experiment, 'off', ['localized'], review), /Never replay/);
    experiment.runs.push({ variant: 'off', task: 'multipart', status: 'PASS' });
    validatePlan(experiment, 'off', ['large'], review);
    experiment.runs.push({ variant: 'off', task: 'large', status: 'PASS' });
    assert.throws(() => continuationBudget(experiment, 1), /0 starts remain/);
    assert.equal(experiment.runs[0].status, 'FAIL');
});

test('continuation preserves failed costs, immutable receipts, prerequisites and eight-start budget', () => {
    const directory = mkdtempSync(join(scratchRoot, 'workflow-receipts-'));
    try {
        const parent = join(directory, 'prior');
        const current = join(directory, 'current');
        mkdirSync(parent);
        mkdirSync(current);
        const failed = join(parent, 'failed.json');
        writeFileSync(failed, '{"status":"FAIL"}');
        writeFileSync(join(parent, 'experiment.json'), JSON.stringify({
            spentLeadRuns: 0, runs: [{ directory: parent, status: 'FAIL' }],
        }));
        writeFileSync(join(parent, 'evidence.json'), JSON.stringify({ initialSetupFailure: { path: failed } }));
        writeFileSync(join(current, 'experiment.json'), JSON.stringify({
            priorExperiment: parent, spentLeadRuns: 1,
            runs: [{ directory: current, status: 'PASS' }, { directory: current, status: 'FAIL' }],
        }));
        const prior = priorState(current);
        assert.equal(prior.starts, 3);
        assert.ok(prior.receipts.some((item) => item.path === failed));
        verifyReceipts(prior.receipts);
        writeFileSync(failed, '{"status":"PASS"}');
        assert.throws(() => verifyReceipts(prior.receipts), /Immutable evidence changed/);
        const experiment = { maximumLeadRuns: 8, spentLeadRuns: 3, runs: [],
            reused: [{ variant: 'baseline', task: 'localized' }] };
        assert.equal(continuationBudget(experiment, 5), 5);
        assert.throws(() => continuationBudget(experiment, 6), /5 starts remain/);
        assert.throws(() => validatePlan(experiment, 'baseline', ['localized']), /Never replay/);
        validatePlan(experiment, 'baseline', ['multipart']);
        assert.throws(() => validatePlan(experiment, 'candidate1', ['localized']), /preceding/);
        experiment.runs.push({ variant: 'baseline', task: 'multipart', status: 'PASS' });
        validatePlan(experiment, 'candidate1', ['localized', 'multipart']);
        experiment.runs.push({ variant: 'candidate1', task: 'localized', status: 'FAIL' });
        assert.throws(() => validatePlan(experiment, 'candidate2', ['localized']), /stopped/);
        experiment.runs.pop();
        experiment.blocked = { reason: 'Cancelled child discovered in audit' };
        assert.throws(() => validatePlan(experiment, 'candidate1', ['localized']), /immutable failure audit/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('supervision stops the owned engine scope before the runner group and cleans startup/timeout credentials', async () => {
    const directory = mkdtempSync(join(scratchRoot, 'workflow-supervision-'));
    try {
        for (const startupFailure of [false, true]) {
            const credentials = join(directory, startupFailure ? 'startup' : 'timeout');
            writeFileSync(credentials, 'local-test-placeholder');
            const order = [];
            const child = new EventEmitter();
            const result = await superviseRun({
                credentials, deadlineMs: 20, launch: {},
                engineScope: { async preflight() {
                    if (startupFailure) throw new Error('startup rejected');
                }, async stop() { order.push('scope'); } },
                spawnProcess: () => child,
                stopGroup: async () => { order.push('group'); child.emit('close', null, 'SIGKILL'); },
            });
            assert.equal(existsSync(credentials), false);
            assert.equal(result.cleanup.engineScopeStopped, true);
            assert.equal(result.cleanup.credentialsRemoved, true);
            if (startupFailure) assert.deepEqual(result.errors, ['startup rejected']);
            else {
                assert.equal(result.timedOut, true);
                assert.equal(result.signal, 'SIGKILL');
                assert.deepEqual(order, ['scope', 'group']);
            }
        }
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('explicit review authorizes only unchanged candidate2 with two baseline references and two remaining starts', () => {
    const directory = mkdtempSync(join(scratchRoot, 'workflow-reviewed-'));
    try {
        const workflow = join(directory, 'candidate2.md');
        const failed = join(directory, 'failed-result.json');
        writeFileSync(workflow, 'Reviewed general workflow guidance');
        writeFileSync(failed, '{"status":"PASS","quarantined":true}');
        const stop = { quarantinedResult: receipt(failed) };
        writeFileSync(join(directory, 'stop.json'), JSON.stringify(stop));
        writeFileSync(join(directory, 'audit.json'), JSON.stringify({ status: 'BLOCKED', remainingLiveLeadStarts: 2,
            candidates: [{ path: 'tests/fixtures/workflow-token-benchmark-candidate2.md', sha256: receipt(workflow).sha256 }] }));
        const receipts = ['stop.json', 'audit.json', 'failed-result.json'].map((path) => receipt(join(directory, path)));
        const prior = { starts: 6, blocked: stop, receipts, manifest: { directory } };
        const review = reviewedContinuation(prior, 'candidate2', workflow);
        const experiment = { maximumLeadRuns: 8, spentLeadRuns: 6, runs: [],
            reused: [{ variant: 'baseline', task: 'localized' }, { variant: 'baseline', task: 'multipart' }] };
        validatePlan(experiment, 'candidate2', ['localized', 'multipart'], review);
        assert.equal(readFileSync(failed, 'utf8'), '{"status":"PASS","quarantined":true}');
        assert.throws(() => validatePlan(experiment, 'candidate1', ['localized'], review), /reviewed changed candidate/);
        assert.throws(() => validatePlan({ ...experiment, spentLeadRuns: 5 }, 'candidate2', ['localized'], review));
        assert.throws(() => validatePlan({ ...experiment, reused: experiment.reused.slice(0, 1) },
            'candidate2', ['localized'], review), /preceding/);
        assert.throws(() => reviewedContinuation(prior, 'candidate1', workflow), /candidate2 only/);
        writeFileSync(workflow, 'Changed guidance');
        assert.throws(() => reviewedContinuation(prior, 'candidate2', workflow), /guidance changed/);
        experiment.runs.push({ variant: 'candidate2', task: 'localized', status: 'PASS' },
            { variant: 'candidate2', task: 'multipart', status: 'PASS' });
        assert.throws(() => continuationBudget(experiment, 1), /0 starts remain/);
        assert.throws(() => validatePlan(experiment, 'candidate2', ['localized'], review), /Never replay/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('authorized internal startup failures retain a failure receipt and remove copied credentials', () => {
    const directory = mkdtempSync(join(scratchRoot, 'workflow-internal-'));
    try {
        const data = join(directory, 'home/mixdog/data');
        mkdirSync(data, { recursive: true });
        const credentials = join(data, 'benchmark-oauth.json');
        writeFileSync(credentials, 'local-test-placeholder');
        const path = join(directory, 'run.json');
        const invocation = randomUUID();
        writeFileSync(path, JSON.stringify({ directory, invocation, task: 'localized', variant: 'baseline',
            engineUnit: `paseodog-${randomUUID().replaceAll('-', '')}.scope`,
            workflowBody: 'Test only', experiment: { directory, dependencyRoot: join(directory, 'absent'),
                staged: directory, deadlineMs: 1000 }, queueMs: 0 }));
        writeFileSync(join(directory, 'experiment.json'), JSON.stringify({ runs: [{
            directory, status: 'STARTED', runHash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        }] }));
        const result = spawnSync(process.execPath, ['scripts/workflow-token-benchmark.mjs', '--execute-run',
            path, '--confirm-api-use'], { encoding: 'utf8', timeout: 10000,
            env: { PATH: process.env.PATH, HOME: join(directory, 'home'), MIXDOG_DATA_DIR: data,
                OPENAI_OAUTH_CREDENTIALS_PATH: credentials, PASEODOG_BENCHMARK_INVOCATION: invocation } });
        assert.equal(result.status, 1);
        assert.equal(existsSync(credentials), false);
        const failure = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
        assert.equal(failure.status, 'FAIL');
        assert.match(failure.errors[0].message, /Cannot find module/);
        assert.equal(failure.requests.length, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real timeout containment removes a live engine descendant from its private cgroup', {
    skip: process.platform !== 'linux' || process.env.PASEODOG_BENCHMARK_CGROUP !== 'true'
        ? 'Set PASEODOG_BENCHMARK_CGROUP=true with a usable systemd --user/DBus session' : false,
}, async () => {
    const directory = mkdtempSync(join(scratchRoot, 'workflow-cgroup-'));
    try {
        const credentials = join(directory, 'credentials');
        const ready = join(directory, 'ready');
        writeFileSync(credentials, 'local-test-placeholder');
        const engineUnit = `paseodog-${randomUUID().replaceAll('-', '')}.scope`;
        const launch = { command: process.execPath, env: { ...process.env }, args: ['-e',
            `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`, '--'] };
        const scope = createProcessScope({ launch, unitName: engineUnit });
        const script = `const {spawn}=require('node:child_process');spawn(${JSON.stringify(scope.command)},${JSON.stringify(scope.args)},{env:process.env,stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
        const result = await superviseRun({ credentials, deadlineMs: 3000, engineScope: scope,
            launch: { command: process.execPath, args: ['-e', script], env: process.env, cwd: directory } });
        assert.equal(existsSync(ready), true, 'No engine descendant was actually started');
        assert.equal(result.timedOut, true);
        assert.deepEqual(result.errors, []);
        assert.equal(result.cleanup.engineScopeStopped, true, 'Existing cgroup stop must verify it empty');
        assert.equal(result.cleanup.runnerGroupStopped, true);
        assert.equal(existsSync(credentials), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('named enabled workflow survives the actual native config write/read path', {
    skip: !process.env.PASEODOG_BENCHMARK_MIXDOG,
}, () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-config-'));
    try {
        const script = `
            import assert from 'node:assert/strict';
            import {pathToFileURL} from 'node:url';
            import {join} from 'node:path';
            import {readFileSync} from 'node:fs';
            const root=process.env.PASEODOG_BENCHMARK_MIXDOG;
            const {updateSection}=await import(pathToFileURL(join(root,'src/runtime/shared/config.mjs')));
            const {loadConfig,saveConfig}=await import(pathToFileURL(join(root,'src/runtime/agent/orchestrator/config.mjs')));
            const {readMarkdownDocument}=await import(pathToFileURL(join(root,'src/runtime/shared/markdown-frontmatter.mjs')));
            const baseline=readMarkdownDocument(readFileSync(join(root,'src/workflows/default/WORKFLOW.md'),'utf8')).body.trim();
            for (const candidate of ['candidate1','candidate2']) {
                const text=readFileSync('tests/fixtures/workflow-token-benchmark-'+candidate+'.md','utf8').trim();
                assert.ok(text.startsWith(baseline),'Candidate changed the baseline authorization policy');
            }
            updateSection('agent',()=>({workflow:{active:'benchmark-baseline'},orchestrationMode:'swarm'}));
            const first=loadConfig({secrets:false});
            assert.equal(first.workflow.active,'benchmark-baseline');
            saveConfig(first);
            assert.equal(loadConfig({secrets:false}).workflow.active,'benchmark-baseline');
            updateSection('agent',()=>({workflow:{active:'none'},orchestrationMode:'swarm',
                enabledAgents:['worker'],agents:{worker:${JSON.stringify(route)}}}));
            const off=loadConfig({secrets:false});
            assert.equal(off.workflow.active,'none');
            assert.equal(off.orchestrationMode,'swarm');
            assert.ok(!off.disabledAgents.includes('worker'));
            assert.equal(off.agents.worker.model,'gpt-6.1-sol');
            assert.equal(off.agents.worker.autoEffort,false);
            console.log('native workflow persistence passed');
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            env: { PATH: process.env.PATH, HOME: directory, MIXDOG_HOME: join(directory, 'mixdog'),
                MIXDOG_DATA_DIR: join(directory, 'mixdog/data'),
                PASEODOG_BENCHMARK_MIXDOG: process.env.PASEODOG_BENCHMARK_MIXDOG },
            encoding: 'utf8', timeout: 10000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /native workflow persistence passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
