import { DomainError } from './policy.mjs';

export function integerCents(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainError(`invalid-${field}`);
    }
    return value;
}

export function positiveQuantity(value, maximum) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new DomainError('invalid-quantity');
    }
    return value;
}

export function roundRatio(numerator, denominator) {
    if (!Number.isSafeInteger(numerator) || numerator < 0) {
        throw new DomainError('invalid-numerator');
    }
    if (!Number.isSafeInteger(denominator) || denominator <= 0) {
        throw new DomainError('invalid-denominator');
    }
    return Math.floor((numerator + denominator / 2) / denominator);
}

export function normalizeLine(input, maximumQuantity) {
    if (!input || typeof input.sku !== 'string' || !input.sku.trim()) {
        throw new DomainError('invalid-sku');
    }
    const quantity = positiveQuantity(input.quantity, maximumQuantity);
    const unitCents = integerCents(input.unitCents, 'unitCents');
    const discountCents = integerCents(input.discountCents ?? 0, 'discountCents');
    const grossCents = quantity * unitCents;
    if (!Number.isSafeInteger(grossCents)) {
        throw new DomainError('line-overflow');
    }
    if (discountCents > grossCents) {
        throw new DomainError('excessive-discount');
    }
    return {
        sku: input.sku.trim(),
        quantity,
        unitCents,
        discountCents,
        grossCents,
        baseCents: grossCents - discountCents,
    };
}

export function priceLines(lines, rateBp) {
    integerCents(rateBp, 'rateBp');
    let subtotalCents = 0;
    let discountCents = 0;
    let taxCents = 0;
    const priced = [];
    for (const line of lines) {
        const lineTax = roundRatio(line.baseCents * rateBp, 10000);
        subtotalCents += line.baseCents;
        discountCents += line.discountCents;
        taxCents += lineTax;
        priced.push({ ...line, taxCents: lineTax });
    }
    const totalCents = subtotalCents + taxCents;
    if (!Number.isSafeInteger(totalCents)) {
        throw new DomainError('invoice-overflow');
    }
    return { lines: priced, subtotalCents, discountCents, taxCents, totalCents };
}

export function remainingCents(invoice) {
    return invoice.totalCents - invoice.refundedCents;
}
