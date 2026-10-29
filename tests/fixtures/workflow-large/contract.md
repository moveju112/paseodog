# Tenant invoice subsystem

This subsystem issues invoices, records refunds and renders tenant summaries.
Money is represented as nonnegative integer cents. The in-memory store is a
stand-in for a transactional repository; all calls in these probes are serial.
The API receives an already authenticated `{tenant, role, actor}` context.
There is no network, clock, random number generator or external database.

## Required behavior

- R01: Idempotency belongs to a tenant. Reusing a request key within that tenant
  returns its original receipt without creating another invoice. The same text
  key in another tenant is independent and must not expose the first receipt.
- R02: Apply line discounts before tax. Add the taxable bases, multiply that
  subtotal by the tenant's basis-point rate, and round half up ONCE per invoice.
  Invoice total is discounted subtotal plus the rounded invoice tax.
- R03: Refunds accumulate. The sum of accepted refunds may not exceed the
  original invoice total. Reject an excessive refund without changing either
  the invoice or its refund ledger. The stored refunded amount is cumulative.
- R04: A tenant summary reflects every successful mutation. A summary read
  after a completed refund must show the new net balance even if a previous
  summary was cached. No time-to-live delay is permitted by this contract.
- R05: A refund requires both the refund role and ownership by the context's
  tenant. A role in one tenant never authorizes a refund of another tenant's
  invoice, and a rejected foreign refund must leave that invoice untouched.
- R06: Negative, fractional or nonnumeric line quantities/prices/discounts are
  rejected. Quantity must be positive, and discount may not exceed line gross.
- R07: A void invoice is not refundable. Voiding an unpaid issued invoice is
  allowed for a billing administrator and must remove it from active totals.
- R08: List operations return only the context's tenant, in sequence order.
  Internal global lookup facilities are not authorization boundaries.

North has a 1,000 basis-point tax rate; South has a zero tax rate. Both use USD.
`billing_admin` may issue, refund, void and read. `viewer` may only read.
Invoice identifiers and sequence numbers are tenant-scoped. Refund identifiers
are store-wide ledger identifiers and do not confer ownership.

## Audit interface

`fixtures.mjs` exports `probeIds` and `runProbe(id)`. Each probe starts with a
fresh store and returns a deliberately small projection of observable behavior.
Audit ALL eight probes, not just the ones covered by the smoke tests.
Infer required projections from this contract; do not change source files.
The smoke tests exercise supported happy paths, not exhaustive correctness.

Return one JSON object with exactly `results`, `findings`, and `summary`.
`results` is in `probeIds` order, and each entry has exactly:
`{"case": "<probe id>", "actual": <runProbe projection>, "required": <contract projection>}`.
`findings` is in rule-number order and contains only violated rules, each as
`{"rule":"Rnn","cases":["<probe id>"],"evidence":["file.mjs#exportedSymbol"]}`.
Give the implementation and its dependency/caller evidence needed to explain
each violation. Evidence anchors must name real exported functions/classes.
Do not substitute a test name or this contract for cross-file source evidence.
`summary` has exactly `{"cases":8,"violations":<finding count>,"controls":<number of probes with actual equal to required>}`.
