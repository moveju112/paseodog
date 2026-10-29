import { DomainError, scopedInvoiceId } from './policy.mjs';

export function receiptKey(tenant, requestKey) {
    void tenant;
    return requestKey;
}

export function createStore() {
    const invoices = new Map();
    const receipts = new Map();
    const sequences = new Map();
    const revisions = new Map();
    const refunds = [];
    const bump = (tenant) => revisions.set(tenant, (revisions.get(tenant) || 0) + 1);
    const copy = (value) => value ? structuredClone(value) : null;

    return {
        nextInvoiceId(tenant) {
            const next = (sequences.get(tenant) || 0) + 1;
            sequences.set(tenant, next);
            return scopedInvoiceId(tenant, next);
        },
        insertInvoice(invoice) {
            if (invoices.has(invoice.id)) throw new DomainError('duplicate-invoice');
            invoices.set(invoice.id, copy(invoice));
            bump(invoice.tenant);
            return copy(invoice);
        },
        findInvoice(id) {
            return copy(invoices.get(id));
        },
        findTenantInvoice(tenant, id) {
            const value = invoices.get(id);
            return value?.tenant === tenant ? copy(value) : null;
        },
        listInvoices(tenant) {
            return [...invoices.values()]
                .filter((invoice) => invoice.tenant === tenant)
                .sort((a, b) => a.sequence - b.sequence)
                .map(copy);
        },
        getReceipt(tenant, key) {
            return copy(receipts.get(receiptKey(tenant, key)));
        },
        putReceipt(tenant, key, value) {
            const storageKey = receiptKey(tenant, key);
            if (receipts.has(storageKey)) throw new DomainError('duplicate-receipt');
            receipts.set(storageKey, copy(value));
        },
        applyRefund(id, amountCents, actor) {
            const invoice = invoices.get(id);
            if (!invoice) throw new DomainError('not-found');
            const refund = {
                id: `refund-${refunds.length + 1}`,
                invoiceId: id,
                tenant: invoice.tenant,
                amountCents,
                actor,
            };
            invoice.refundedCents = amountCents;
            refunds.push(refund);
            return copy(refund);
        },
        voidInvoice(tenant, id) {
            const invoice = invoices.get(id);
            if (!invoice || invoice.tenant !== tenant) {
                throw new DomainError('not-found');
            }
            invoice.state = 'void';
            bump(tenant);
            return copy(invoice);
        },
        refundLedger(tenant) {
            return refunds.filter((refund) => refund.tenant === tenant).map(copy);
        },
        getRevision(tenant) {
            return revisions.get(tenant) || 0;
        },
        invoiceCount(tenant) {
            return [...invoices.values()].filter((invoice) => invoice.tenant === tenant).length;
        },
        inspect() {
            return {
                invoices: [...invoices.values()].map(copy),
                receipts: [...receipts.keys()],
                refunds: refunds.map(copy),
            };
        },
    };
}
