import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.mjs';
import { createService } from './service.mjs';
import { context, request, refund } from './fixtures.mjs';
import { roundRatio, normalizeLine } from './money.mjs';

test('integer ratio uses half-up rounding', () => {
    assert.equal(roundRatio(15, 10), 2);
    assert.equal(roundRatio(14, 10), 1);
    assert.equal(roundRatio(0, 10), 0);
    assert.throws(() => roundRatio(-1, 10), /invalid-numerator/);
});

test('normalizing lines retains a whole-line discount', () => {
    const line = normalizeLine({
        sku: ' support ',
        quantity: 2,
        unitCents: 500,
        discountCents: 100,
    }, 10000);
    assert.equal(line.sku, 'support');
    assert.equal(line.grossCents, 1000);
    assert.equal(line.baseCents, 900);
    assert.throws(() => normalizeLine({ ...line, quantity: 0 }, 10000), /invalid-quantity/);
});

test('issuing twice with the same tenant and key returns one receipt', () => {
    const store = createStore();
    const service = createService(store);
    const caller = context('south');
    const first = service.issue(caller, request('repeat'));
    const second = service.issue(caller, request('repeat'));
    assert.deepEqual(second, first);
    assert.equal(store.invoiceCount('south'), 1);
});

test('viewer cannot mutate invoice state', () => {
    const service = createService();
    const viewer = context('south', 'viewer');
    assert.throws(() => service.issue(viewer, request('forbidden')), /forbidden/);
    assert.throws(() => service.refund(viewer, refund('south:inv-1', 10)), /forbidden/);
    assert.throws(() => service.void(viewer, 'south:inv-1'), /forbidden/);
});

test('one refund exposes its ledger and remaining balance', () => {
    const service = createService();
    const caller = context('south');
    const receipt = service.issue(caller, request('first'));
    service.refund(caller, refund(receipt.id, 100));
    const [row] = service.list(caller);
    assert.equal(row.remainingCents, 900);
    assert.equal(service.ledger(caller)[0].amountCents, 100);
});

test('void invoices leave active totals and cross-tenant reads are absent', () => {
    const service = createService();
    const caller = context('south');
    const receipt = service.issue(caller, request('close'));
    service.void(caller, receipt.id);
    assert.equal(service.summary(caller).netCents, 0);
    assert.equal(service.summary(caller).void, 1);
    assert.throws(() => service.get(context('north'), receipt.id), /not-found/);
});
