// 정답은 모델 출력과 무관하게 고정한다. 두 작업 모두 파일을 변경하지 않는 감사 작업이다.
export const fixtures = {
    localized: {
        files: {
            'ports.json': JSON.stringify([
                { id: 'a', value: '443' }, { id: 'b', value: '00080' },
                { id: 'c', value: ' 8080 ' }, { id: 'd', value: '12x' },
                { id: 'e', value: '' }, { id: 'f', value: '0' },
                { id: 'g', value: '65535' }, { id: 'h', value: '65536' },
                { id: 'i', value: '-1' }, { id: 'j', value: '1.5' },
                { id: 'k', value: '+80' }, { id: 'l', value: '1e3' },
                { id: 'm', value: '53' }, { id: 'n', value: '\t22\n' },
                { id: 'o', value: '  ' }, { id: 'p', value: '１２' },
            ], null, 2),
        },
        prompt: 'Audit ports.json. A valid port is a string that, after trimming surrounding whitespace, '
            + 'contains only ASCII decimal digits and has integer value 1 through 65535 inclusive. '
            + 'Leading zeroes are allowed. Return one JSON object only: '
            + '{"accepted":[{"id":"...","port":123}],"rejected":["..."]}. '
            + 'Preserve input order within each array. Do not modify files.',
        expected: {
            accepted: [{ id: 'a', port: 443 }, { id: 'b', port: 80 }, { id: 'c', port: 8080 },
                { id: 'g', port: 65535 }, { id: 'm', port: 53 }, { id: 'n', port: 22 }],
            rejected: ['d', 'e', 'f', 'h', 'i', 'j', 'k', 'l', 'o', 'p'],
        },
    },
    multipart: {
        files: {
            'billing.json': JSON.stringify({
                rules: 'For each account, sum charges minus refunds for USD rows whose status is posted. '
                    + 'Ignore other currencies and statuses. Amounts are integer cents. Include every account '
                    + 'listed in accounts, even if its total is zero.',
                accounts: ['alpha', 'beta', 'gamma', 'delta'],
                rows: [
                    ['alpha', 'charge', 1250, 'USD', 'posted'], ['alpha', 'refund', 250, 'USD', 'posted'],
                    ['beta', 'charge', 730, 'USD', 'posted'], ['beta', 'charge', 270, 'USD', 'posted'],
                    ['beta', 'refund', 125, 'USD', 'posted'], ['gamma', 'refund', 400, 'USD', 'posted'],
                    ['gamma', 'charge', 400, 'USD', 'posted'], ['alpha', 'charge', 999, 'EUR', 'posted'],
                    ['delta', 'charge', 999, 'USD', 'pending'], ['gamma', 'refund', 80, 'USD', 'void'],
                    ['alpha', 'charge', 333, 'USD', 'posted'], ['beta', 'refund', 75, 'USD', 'posted'],
                    ['delta', 'refund', 12, 'USD', 'pending'], ['gamma', 'charge', 25, 'USD', 'posted'],
                ],
                columns: ['account', 'kind', 'cents', 'currency', 'status'],
            }, null, 2),
            'inventory.json': JSON.stringify({
                rules: 'Starting from opening stock, apply only posted movements: receipt adds quantity, '
                    + 'sale subtracts quantity, return adds quantity, damage subtracts quantity. '
                    + 'Ignore pending/void movements. Report all SKUs in opening order.',
                opening: [['red', 40], ['blue', 12], ['green', 0], ['black', 9]],
                rows: [
                    ['red', 'sale', 7, 'posted'], ['red', 'return', 2, 'posted'],
                    ['blue', 'receipt', 8, 'posted'], ['blue', 'sale', 6, 'posted'],
                    ['green', 'receipt', 15, 'posted'], ['green', 'damage', 3, 'posted'],
                    ['black', 'sale', 4, 'posted'], ['black', 'damage', 1, 'posted'],
                    ['red', 'receipt', 99, 'pending'], ['blue', 'damage', 9, 'void'],
                    ['green', 'sale', 5, 'posted'], ['black', 'return', 2, 'posted'],
                    ['red', 'damage', 1, 'posted'], ['blue', 'return', 1, 'posted'],
                    ['green', 'return', 1, 'posted'], ['black', 'receipt', 100, 'pending'],
                ],
                columns: ['sku', 'kind', 'quantity', 'status'],
            }, null, 2),
        },
        prompt: 'Complete two independent audits using billing.json and inventory.json and the rules in each file. '
            + 'Return one JSON object only: {"billing":[{"account":"...","cents":123}],'
            + '"inventory":[{"sku":"...","quantity":123}],"checks":{"billingSum":123,"inventorySum":123}}. '
            + 'Preserve accounts/opening order. The checks are the sums of the two output arrays. '
            + 'Use delegation if useful; you remain responsible for the combined answer. Do not modify files.',
        expected: {
            billing: [{ account: 'alpha', cents: 1333 }, { account: 'beta', cents: 800 },
                { account: 'gamma', cents: 25 }, { account: 'delta', cents: 0 }],
            inventory: [{ sku: 'red', quantity: 34 }, { sku: 'blue', quantity: 15 },
                { sku: 'green', quantity: 8 }, { sku: 'black', quantity: 6 }],
            checks: { billingSum: 2158, inventorySum: 63 },
        },
    },
};
