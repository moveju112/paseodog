# PaseoDog 1.0.0-rc.4 verification

## Issue closure scope

| Finding | Implemented remedy | Test evidence | Residual limit |
|---|---|---|---|
| Journal ENOSPC + rejected `kill()` triggers Node unhandled rejection | Catch rejected, synchronously thrown, and non-settling kill promises; bound cleanup; report containment uncertainty; preserve running receipt as uncertain; block late callbacks | `tests/containment-failure.test.mjs` covers four cleanup outcomes and unrelated session open | No actual disk full or failing systemd manager tested in a user's host |
| Android `aabcdefg` after text-first/key-second callback | Strict upstream blob patch to suppress one duplicate text-first printable event while preserving key-only fallback | `tests/paseo-android-terminal-patch.test.mjs` synthetic ordering checks | Official APK unchanged, Samsung Keyboard event trace not obtained |
| Android Backspace under text-first callback ordering | Patch accounts for text-first suffix deletions by Unicode code point, consumes matching late Backspace | Synthetic tests for both orders, repeated keys, Hangul and emoji | Other composition IMEs and real-device timing unverified |
| Korean terminal display cursor drifts | Document exact byte-vs-glyph acceptance and native/legacy renderer differential diagnosis | UTF-8 bridge split tests already in rc.3; synthetic input patch tests | Pixel-alignment cannot be declared fixed without Android screenshots and fonts/density comparison |
| Actual native systemd + model + mobile UI | Preserve fail-closed cgroup policy and live acceptance checklist | GitHub CI native install+patch and `--check` (no credentials) | Need authorized Ubuntu host, login, and Android device |

## Environment and test status

- Local Node: v22.16.0, **below supported range**. Use GitHub Actions Node 24 results as the supported-run evidence.
- Original rc.3 suite: 88 passing. Added 4 containment fault tests and 11 Android state tests; total **103** passing locally.
- New Android patch: validates exact reviewed Git blob `4eea8a1da313e7348b06357ad007dd1557ebd732`; the CI SDK job also fetches the pinned upstream file, applies the source patch and parses its TSX using TypeScript, with no APK build.
- The old `reports/unit-tests.tap` is historical rc.1 evidence; no newly claimed live model execution.
- `npm run check` and release package integrity pass locally; generated SHA-256 ZIP is recorded by `scripts/package.py`.

## Safe delivery

Server is changed in `plugin/server/connection.mjs`. A custom app patch lives at `scripts/patch-paseo-android.mjs` and `docs/ANDROID-TERMINAL.md`; it is **not applied by `scripts/install.sh`** because PaseoDog and the Android app are separate codebases.

No actual credentials or API tokens are required for test scripts. Live model calls require user opt-in and plan quota. Commands approved through Mixdog run with the hosting Unix user's permissions; this tool is not a sandbox.
