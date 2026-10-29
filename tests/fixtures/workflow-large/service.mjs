import { requireRole, validateRequestKey, DomainError } from './policy.mjs';
import { createDraft, assertRefundable, assertVoidable, invoiceReceipt } from './invoice.mjs';
import { createStore } from './store.mjs';
import { createViews } from './views.mjs';

export function issueInvoice(store, context, request) {
    requireRole(context, 'issue');
    const key = validateRequestKey(request.requestKey);
    const prior = store.getReceipt(context.tenant, key);
    if (prior) return prior;
    const draft = createDraft(context.tenant, request);
    const id = store.nextInvoiceId(context.tenant);
    const sequence = Number(id.slice(id.lastIndexOf('-') + 1));
    const invoice = store.insertInvoice({
        ...draft,
        id,
        sequence,
        issuedBy: context.actor,
    });
    const receipt = invoiceReceipt(invoice);
    store.putReceipt(context.tenant, key, receipt);
    return receipt;
}

export function refundInvoice(store, context, request) {
    requireRole(context, 'refund');
    const invoice = store.findInvoice(request.invoiceId);
    assertRefundable(invoice, request.amountCents, request.currency);
    return store.applyRefund(invoice.id, request.amountCents, context.actor);
}

export function voidInvoice(store, context, invoiceId) {
    requireRole(context, 'void');
    const invoice = store.findTenantInvoice(context.tenant, invoiceId);
    assertVoidable(invoice);
    return store.voidInvoice(context.tenant, invoice.id);
}

export function createService(store = createStore()) {
    const views = createViews(store);
    return {
        issue(context, request) {
            return issueInvoice(store, context, request);
        },
        refund(context, request) {
            return refundInvoice(store, context, request);
        },
        void(context, invoiceId) {
            return voidInvoice(store, context, invoiceId);
        },
        list(context) {
            requireRole(context, 'read');
            return views.invoiceRows(context.tenant);
        },
        summary(context) {
            requireRole(context, 'read');
            return views.tenantSummary(context.tenant);
        },
        ledger(context) {
            requireRole(context, 'read');
            return store.refundLedger(context.tenant);
        },
        get(context, invoiceId) {
            requireRole(context, 'read');
            const invoice = store.findTenantInvoice(context.tenant, invoiceId);
            if (!invoice) throw new DomainError('not-found');
            return invoiceReceipt(invoice);
        },
    };
}
