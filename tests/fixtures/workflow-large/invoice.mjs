import { DomainError, tenantPolicy, taxSettings } from './policy.mjs';
import { normalizeLine, priceLines, integerCents, remainingCents } from './money.mjs';

export function validateCustomer(customer) {
    if (!customer || typeof customer.id !== 'string' || !customer.id.trim()) {
        throw new DomainError('invalid-customer');
    }
    if (typeof customer.name !== 'string' || !customer.name.trim()) {
        throw new DomainError('invalid-customer-name');
    }
    return { id: customer.id.trim(), name: customer.name.trim() };
}

export function createDraft(tenant, request) {
    const policy = tenantPolicy(tenant);
    const tax = taxSettings(tenant, request.currency);
    if (!Array.isArray(request.lines) || request.lines.length === 0) {
        throw new DomainError('missing-lines');
    }
    if (request.lines.length > policy.maxLines) {
        throw new DomainError('too-many-lines');
    }
    const customer = validateCustomer(request.customer);
    const normalized = request.lines.map((line) => normalizeLine(line, policy.maxQuantity));
    const price = priceLines(normalized, tax.rateBp);
    if (price.totalCents > policy.maxInvoiceCents) {
        throw new DomainError('invoice-limit');
    }
    return {
        tenant,
        currency: tax.currency,
        customer,
        ...price,
        taxRateBp: tax.rateBp,
        state: 'issued',
        refundedCents: 0,
    };
}

export function assertRefundable(invoice, amountCents, currency) {
    if (!invoice) throw new DomainError('not-found');
    if (invoice.state !== 'issued') throw new DomainError('not-refundable');
    if (invoice.currency !== currency) throw new DomainError('currency-mismatch');
    integerCents(amountCents, 'refundCents');
    if (amountCents === 0) throw new DomainError('empty-refund');
    if (amountCents > remainingCents(invoice)) {
        throw new DomainError('refund-exceeds-remaining');
    }
    return invoice;
}

export function assertVoidable(invoice) {
    if (!invoice) throw new DomainError('not-found');
    if (invoice.state !== 'issued') throw new DomainError('not-voidable');
    if (invoice.refundedCents !== 0) throw new DomainError('already-refunded');
    return invoice;
}

export function invoiceReceipt(invoice) {
    return {
        id: invoice.id,
        tenant: invoice.tenant,
        currency: invoice.currency,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        state: invoice.state,
    };
}
