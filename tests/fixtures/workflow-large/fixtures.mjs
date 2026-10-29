import { createStore } from './store.mjs';
import { createService } from './service.mjs';

export const probeIds = [
    'tenant-key',
    'tax-split',
    'refund-series',
    'summary-after-refund',
    'foreign-refund',
    'invalid-line',
    'void-refund',
    'tenant-list',
];

export function context(tenant, role = 'billing_admin') {
    return { tenant, role, actor: `${tenant}-operator` };
}

export function request(requestKey, unitCents = 1000) {
    return {
        requestKey,
        currency: 'USD',
        customer: { id: 'customer-1', name: 'Example Customer' },
        lines: [{ sku: 'service', quantity: 1, unitCents, discountCents: 0 }],
    };
}

export function refund(invoiceId, amountCents) {
    return { invoiceId, amountCents, currency: 'USD' };
}

export function captureError(operation) {
    try {
        operation();
        return null;
    } catch (error) {
        return error.code || error.message;
    }
}

export function runProbe(id) {
    const store = createStore();
    const service = createService(store);
    const north = context('north');
    const south = context('south');
    if (id === 'tenant-key') {
        service.issue(north, request('shared'));
        const second = service.issue(south, request('shared'));
        return {
            returnedTenant: second.tenant,
            southInvoices: store.invoiceCount('south'),
        };
    }
    if (id === 'tax-split') {
        const input = request('split', 5);
        input.lines = ['one', 'two', 'three'].map((sku) => ({
            sku,
            quantity: 1,
            unitCents: 5,
            discountCents: 0,
        }));
        const receipt = service.issue(north, input);
        return {
            taxCents: receipt.taxCents,
            totalCents: receipt.totalCents,
        };
    }
    if (id === 'refund-series') {
        const receipt = service.issue(south, request('series'));
        const amounts = [400, 400, 300];
        let accepted = 0;
        for (const amount of amounts) {
            const error = captureError(() => service.refund(south, refund(receipt.id, amount)));
            if (!error) accepted++;
        }
        const invoice = store.findTenantInvoice('south', receipt.id);
        return {
            accepted,
            refundedCents: invoice.refundedCents,
            ledgerCents: service.ledger(south).reduce((sum, item) => sum + item.amountCents, 0),
        };
    }
    if (id === 'summary-after-refund') {
        const receipt = service.issue(south, request('summary'));
        const before = service.summary(south);
        service.refund(south, refund(receipt.id, 100));
        const after = service.summary(south);
        return {
            beforeCents: before.netCents,
            afterCents: after.netCents,
        };
    }
    if (id === 'foreign-refund') {
        const receipt = service.issue(north, request('foreign'));
        const error = captureError(() => service.refund(south, refund(receipt.id, 100)));
        const invoice = store.findTenantInvoice('north', receipt.id);
        return {
            authorized: error === null,
            tenant: invoice.tenant,
            refundedCents: invoice.refundedCents,
        };
    }
    if (id === 'invalid-line') {
        const input = request('invalid', -1);
        return { error: captureError(() => service.issue(south, input)) };
    }
    if (id === 'void-refund') {
        const receipt = service.issue(south, request('void'));
        service.void(south, receipt.id);
        return {
            error: captureError(() => service.refund(south, refund(receipt.id, 100))),
            state: store.findTenantInvoice('south', receipt.id).state,
        };
    }
    if (id === 'tenant-list') {
        service.issue(north, request('list-north'));
        service.issue(south, request('list-south'));
        return { ids: service.list(context('south', 'viewer')).map((invoice) => invoice.id) };
    }
    throw new Error(`Unknown probe: ${id}`);
}
