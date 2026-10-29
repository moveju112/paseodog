import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { largeFixture, evaluateLargeAnswer } from './fixtures/workflow-token-large.mjs';
import { probeIds, runProbe } from './fixtures/workflow-large/fixtures.mjs';
import { validatePlan, continuationBudget, evaluateAnswer } from '../scripts/workflow-token-benchmark.mjs';

test('large fixture independently specified actual projections and contract computations agree with authored oracle', () => {
    assert.deepEqual(probeIds, largeFixture.expected.results.map((result) => result.case));
    for (const result of largeFixture.expected.results) assert.deepEqual(runProbe(result.case), result.actual);
    // 결함 구현의 계산 함수를 재사용하지 않고 계약의 금액·소유권 규칙을 계산한다.
    const tax = Math.floor((3 * 5 * 1000 + 5000) / 10000);
    let cumulative = 0, accepted = 0;
    for (const amount of [400, 400, 300]) {
        if (cumulative + amount > 1000) continue;
        cumulative += amount;
        accepted++;
    }
    const required = [
        { returnedTenant: 'south', southInvoices: 1 },
        { taxCents: tax, totalCents: 3 * 5 + tax },
        { accepted, refundedCents: cumulative, ledgerCents: cumulative },
        { beforeCents: 1000, afterCents: 1000 - 100 },
        { authorized: 'south' === String('north'), tenant: 'north', refundedCents: 0 },
        { error: 'invalid-unitCents' },
        { error: 'not-refundable', state: 'void' },
        { ids: ['south:inv-1'] },
    ];
    assert.deepEqual(largeFixture.expected.results.map((result) => result.required), required);
    const violated = largeFixture.expected.results.filter((result) =>
        JSON.stringify(result.actual) !== JSON.stringify(result.required));
    assert.equal(violated.length, 5);
    assert.deepEqual(violated.map((result) => result.case),
        largeFixture.expected.findings.map((finding) => finding.cases[0]));
    for (const finding of largeFixture.expected.findings) {
        assert.ok(new Set(finding.evidence.map((anchor) => anchor.split('#')[0])).size >= 2);
    }
});

test('large oracle requires all projections, findings and cross-file evidence without arbitrary prose matching', () => {
    const expected = structuredClone(largeFixture.expected);
    assert.equal(evaluateLargeAnswer(JSON.stringify(expected)).pass, true);
    expected.findings[0].evidence.reverse();
    assert.equal(evaluateLargeAnswer(JSON.stringify(expected)).pass, true);
    expected.findings[0].evidence.pop();
    const partial = evaluateLargeAnswer(JSON.stringify(expected));
    assert.equal(partial.pass, false);
    assert.equal(partial.coverage.findings, 4);
    expected.results[2].required.refundedCents = 300;
    assert.equal(evaluateLargeAnswer(JSON.stringify(expected)).coverage.cases, 7);
    assert.equal(evaluateLargeAnswer('{}').pass, false);
    assert.equal(evaluateAnswer('large', JSON.stringify(largeFixture.expected)).pass, true);
});

test('reviewed size comparison permits one new run per workflow after a failed different workflow, never a replay', () => {
    const reviewed = { kind: 'large-comparison', spentLeadRuns: 8, maximumLeadRuns: 11,
        variants: ['baseline', 'candidate1', 'candidate2'], fixtureHash: 'same-authored-fixture' };
    const experiment = { spentLeadRuns: 8, maximumLeadRuns: 11, runs: [],
        largeFixtureHash: 'same-authored-fixture' };
    validatePlan(experiment, 'baseline', ['large'], reviewed);
    assert.throws(() => validatePlan(experiment, 'baseline', ['localized'], reviewed));
    assert.throws(() => validatePlan(experiment, 'candidate1', ['large'], reviewed), /next new workflow/);
    experiment.runs.push({ variant: 'baseline', task: 'large', status: 'FAIL' });
    validatePlan(experiment, 'candidate1', ['large'], reviewed);
    assert.throws(() => validatePlan(experiment, 'baseline', ['large'], reviewed), /Never replay/);
    experiment.runs.push({ variant: 'candidate1', task: 'large', status: 'FAIL' });
    validatePlan(experiment, 'candidate2', ['large'], reviewed);
    experiment.runs.push({ variant: 'candidate2', task: 'large', status: 'PASS' });
    assert.throws(() => continuationBudget(experiment, 1), /0 starts remain/);
    assert.equal(experiment.runs.filter((run) => run.status === 'FAIL').length, 2);
});

test('large fixture is a substantive multi-file subsystem with executable happy-path tests', () => {
    assert.equal(Object.keys(largeFixture.files).length, 9);
    const meaningful = Object.values(largeFixture.files).flatMap((text) => text.split('\n'))
        .filter((line) => line.trim() && !line.trim().startsWith('//')).length;
    assert.ok(meaningful >= 500 && meaningful <= 1000, `Meaningful line count: ${meaningful}`);
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const result = spawnSync(process.execPath, ['--test', 'tests/fixtures/workflow-large/smoke.test.mjs'],
        { encoding: 'utf8', timeout: 10000, env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /pass 6/);
});
