import { remainingCents } from './money.mjs';

export function summarizeInvoices(invoices) {
    const summary = {
        issued: 0,
        void: 0,
        billedCents: 0,
        refundedCents: 0,
        netCents: 0,
    };
    for (const invoice of invoices) {
        if (invoice.state === 'void') {
            summary.void++;
            continue;
        }
        summary.issued++;
        summary.billedCents += invoice.totalCents;
        summary.refundedCents += invoice.refundedCents;
        summary.netCents += remainingCents(invoice);
    }
    return summary;
}

export function createViews(store) {
    const cache = new Map();
    return {
        tenantSummary(tenant) {
            const revision = store.getRevision(tenant);
            const prior = cache.get(tenant);
            if (prior?.revision === revision) {
                return structuredClone(prior.value);
            }
            const value = summarizeInvoices(store.listInvoices(tenant));
            cache.set(tenant, { revision, value: structuredClone(value) });
            return value;
        },
        invoiceRows(tenant) {
            return store.listInvoices(tenant).map((invoice) => ({
                id: invoice.id,
                customerId: invoice.customer.id,
                state: invoice.state,
                totalCents: invoice.totalCents,
                remainingCents: remainingCents(invoice),
            }));
        },
        clear() {
            cache.clear();
        },
    };
}
