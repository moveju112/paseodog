export class DomainError extends Error {
    constructor(code) {
        super(code);
        this.name = 'DomainError';
        this.code = code;
    }
}

const tenants = Object.freeze({
    north: Object.freeze({
        currency: 'USD',
        taxRateBp: 1000,
        maxLines: 50,
        maxQuantity: 10000,
        maxInvoiceCents: 10000000,
    }),
    south: Object.freeze({
        currency: 'USD',
        taxRateBp: 0,
        maxLines: 50,
        maxQuantity: 10000,
        maxInvoiceCents: 10000000,
    }),
});

const permissions = Object.freeze({
    billing_admin: Object.freeze(['issue', 'refund', 'void', 'read']),
    viewer: Object.freeze(['read']),
});

export function tenantPolicy(tenant) {
    const value = tenants[tenant];
    if (!value) throw new DomainError('unknown-tenant');
    return value;
}

export function validateContext(context) {
    if (!context || typeof context !== 'object') {
        throw new DomainError('missing-context');
    }
    tenantPolicy(context.tenant);
    if (typeof context.actor !== 'string' || !context.actor.trim()) {
        throw new DomainError('missing-actor');
    }
    if (!Object.hasOwn(permissions, context.role)) {
        throw new DomainError('unknown-role');
    }
    return context;
}

export function requireRole(context, action) {
    validateContext(context);
    if (!permissions[context.role].includes(action)) {
        throw new DomainError('forbidden');
    }
    return context;
}

export function taxSettings(tenant, currency) {
    const policy = tenantPolicy(tenant);
    if (currency !== policy.currency) {
        throw new DomainError('currency-mismatch');
    }
    return {
        currency: policy.currency,
        rateBp: policy.taxRateBp,
        rounding: 'half-up-invoice',
    };
}

export function scopedInvoiceId(tenant, sequence) {
    tenantPolicy(tenant);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new DomainError('invalid-sequence');
    }
    return `${tenant}:inv-${sequence}`;
}

export function validateRequestKey(key) {
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(key)) {
        throw new DomainError('invalid-request-key');
    }
    return key;
}
