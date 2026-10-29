import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const names = ['contract.md', 'policy.mjs', 'money.mjs', 'store.mjs', 'invoice.mjs',
    'views.mjs', 'service.mjs', 'fixtures.mjs', 'smoke.test.mjs'];
export const largeFixture = {
    files: Object.fromEntries(names.map((name) => [name, readFileSync(new URL(`./workflow-large/${name}`, import.meta.url), 'utf8')])),
    prompt: 'Perform a read-only code audit of the invoice subsystem in this directory. Read contract.md '
        + 'for the complete behavioral requirements and output schema, and inspect the source, configuration, '
        + 'probes and tests. Audit every probe in fixtures.mjs; report all and only contract violations with '
        + 'the cross-file source evidence needed to establish them. Return the complete JSON object specified '
        + 'by the contract, not prose or a patch. Do not modify files. Delegate independent work if useful.',
    expected: {
        results: [
            { case: 'tenant-key', actual: { returnedTenant: 'north', southInvoices: 0 }, required: { returnedTenant: 'south', southInvoices: 1 } },
            { case: 'tax-split', actual: { taxCents: 3, totalCents: 18 }, required: { taxCents: 2, totalCents: 17 } },
            { case: 'refund-series', actual: { accepted: 3, refundedCents: 300, ledgerCents: 1100 }, required: { accepted: 2, refundedCents: 800, ledgerCents: 800 } },
            { case: 'summary-after-refund', actual: { beforeCents: 1000, afterCents: 1000 }, required: { beforeCents: 1000, afterCents: 900 } },
            { case: 'foreign-refund', actual: { authorized: true, tenant: 'north', refundedCents: 100 }, required: { authorized: false, tenant: 'north', refundedCents: 0 } },
            { case: 'invalid-line', actual: { error: 'invalid-unitCents' }, required: { error: 'invalid-unitCents' } },
            { case: 'void-refund', actual: { error: 'not-refundable', state: 'void' }, required: { error: 'not-refundable', state: 'void' } },
            { case: 'tenant-list', actual: { ids: ['south:inv-1'] }, required: { ids: ['south:inv-1'] } },
        ],
        findings: [
            { rule: 'R01', cases: ['tenant-key'], evidence: ['service.mjs#issueInvoice', 'store.mjs#receiptKey'] },
            { rule: 'R02', cases: ['tax-split'], evidence: ['money.mjs#priceLines', 'policy.mjs#taxSettings', 'invoice.mjs#createDraft'] },
            { rule: 'R03', cases: ['refund-series'], evidence: ['store.mjs#createStore', 'invoice.mjs#assertRefundable', 'money.mjs#remainingCents'] },
            { rule: 'R04', cases: ['summary-after-refund'], evidence: ['store.mjs#createStore', 'views.mjs#createViews'] },
            { rule: 'R05', cases: ['foreign-refund'], evidence: ['service.mjs#refundInvoice', 'store.mjs#createStore', 'policy.mjs#requireRole'] },
        ],
        summary: { cases: 8, violations: 5, controls: 3 },
    },
};

const anchors = new Set(Object.entries(largeFixture.files).flatMap(([path, text]) =>
    [...text.matchAll(/export (?:function|class) (\w+)/g)].map((match) => `${path}#${match[1]}`)));

export function evaluateLargeAnswer(content) {
    let actual;
    try {
        actual = JSON.parse(content.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, ''));
        const cases = largeFixture.expected.results.filter((result, index) =>
            isDeepStrictEqual(actual.results?.[index], result)).length;
        const findings = largeFixture.expected.findings.filter((finding) => {
            const got = actual.findings?.find((item) => item.rule === finding.rule);
            return got && isDeepStrictEqual(got.cases, finding.cases)
                && finding.evidence.every((anchor) => got.evidence?.includes(anchor))
                && got.evidence.every((anchor) => anchors.has(anchor));
        }).length;
        const stripEvidence = (value) => ({ ...value, findings: value.findings.map(({ evidence, ...finding }) => finding) });
        const validEvidence = actual.findings.every((item) => Array.isArray(item.evidence)
            && item.evidence.length >= 2 && new Set(item.evidence).size === item.evidence.length);
        return { pass: cases === 8 && findings === 5 && validEvidence
            && isDeepStrictEqual(stripEvidence(actual), stripEvidence(largeFixture.expected)),
        coverage: { cases, totalCases: 8, findings, totalFindings: 5 }, actual };
    } catch {
        return { pass: false, coverage: { cases: 0, totalCases: 8, findings: 0, totalFindings: 5 },
            error: 'Answer does not satisfy the complete audit JSON schema' };
    }
}
