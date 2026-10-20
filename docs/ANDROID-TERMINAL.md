# Paseo Android terminal typing/UTF-8 and cursor alignment

**Scope:** PaseoDog's Android app source is under `android/`, with the native
client in `android/packages/app/`. It includes the existing PaseoDog branding
and updater. Updating the Linux provider alone does not replace an installed
Android APK; native UI changes require rebuilding that client.

## Findings and mitigation

The app's native hidden `EditingTextInput` currently handles printable ASCII
on `onKeyPress` *and* insertion on `onChangeText`. With out-of-order callbacks
(e.g. `onChangeText('a')` before `onKeyPress('a')`), the same character can be
sent twice. The same ordering affects Backspace. The upstream issue remains
[getpaseo/paseo#5176](https://github.com/getpaseo/paseo/issues/5176), including
users reporting the Samsung Keyboard and Korean/English issues.

The opt-in source patch shipped here (`scripts/patch-paseo-android.mjs`) is pinned
strictly to the independently reviewed upstream Git blob at Paseo
`166aabd57b3f6c69f6a6f65b621aba167e7e3be8`. It:

- suppresses a **single duplicate** printable keypress after an earlier matching
  `onChangeText` insertion, preserving keypress-only fallback;
- reconciles trailing Backspace edits whether text change or keypress arrives
  first, including emoji code-point deletion;
- preserves original Hangul IME composition suffix reconciliation,
  non-CJK autocorrect desync safeguards and terminal special keys.

**Important limits:** No Android physical device, Samsung IME trace or visual
cursor pixel measurement was available in this build environment. The patch
fixes synthetic callback-order regressions; it is *not* a verified cure for
Samsung IME event variants or for pixel-level glyph/cursor misalignment on
all fonts/densities. Real key events may differ from the synthetic sequences.

### Immediately usable workaround (no custom Android build)

On the official Paseo Android app, open **Settings → Diagnostics → Use legacy
terminal renderer**; close and reopen the terminal. This selects the other
rendering path; it is diagnostic/workaround, **not** proof the bug is fixed.
Alternatively, keep Paseo for chat/agent approvals and use a dedicated SSH
client for text terminals on Linux. This avoids the affected app-native terminal
input and still accesses the same remote host.

## Existing PaseoDog Android source

Use `android/` for PaseoDog client changes. Its npm workspace includes shared
protocol/client packages needed by the app. Dependencies, build caches, SDKs
and signing keys are not source files and were not imported with the source.
Build prerequisites and commands are described in `android/docs/android.md`;
PaseoDog's actual application ID and branding are defined by
`android/packages/app/app.config.js` and the existing native Android project.
Do not replace an installed APK with a differently signed build.

The following terminal-input patch procedure is for a separately pinned
upstream checkout; it is not the general PaseoDog app build/update procedure.

## Apply the terminal fix to a separate upstream source checkout

```bash
# Requires Git, Node, Android SDK and a separate Paseo source checkout.
git clone https://github.com/getpaseo/paseo.git ~/src/paseo-android
cd ~/src/paseo-android
git checkout 166aabd57b3f6c69f6a6f65b621aba167e7e3be8
node /path/to/paseodog/scripts/patch-paseo-android.mjs --check .
node /path/to/paseodog/scripts/patch-paseo-android.mjs --apply .
git diff -- packages/app/src/terminal/native-renderer/terminal-input.native.tsx
```

`--check` and `--apply` fail if the original source blob does **not** match
this audited version. The change is made only to this separate source checkout;
**it does not affect the Paseo Android app already installed on your phone.**

From that checkout, follow Paseo's development build instructions. At the
pinned release `packages/app/package.json` advertises:

```bash
npm ci
npm --prefix packages/app run android:development
```

Building requires an Android SDK/device (or emulator), a valid Expo/React
Native development environment, and dependencies. A dev build uses a different
app identifier than a store-signed production APK. Do not try to replace a
production store build with a differently signed APK. Preserve original app
data/credentials separately. No unsigned APK or fabricated successful build
is included with PaseoDog.

## On-device acceptance: required before saying this bug is fixed

1. Record app/daemon/Android/Samsung Keyboard versions and native vs legacy
   renderer. Use a **disposable SSH test shell**, never a real password prompt.
2. Enter `abcdefg`, `aaaa`, and `pwd` repeatedly with Samsung Keyboard English;
   compare displayed text and `stty`/PTY-captured exact input bytes.
3. Press Backspace repeatedly after characters and after clearing the input;
   ensure no double DEL and no nonfunctional Backspace.
4. Type/delete Hangul: `ㅎ → 하 → 한 → 하`, plus `한글 test😀` and cursor at
   beginning, middle and end of lines. Re-test after keyboard hide/show and
   device rotation.
5. On at least two Android font scales / densities, visually compare the
   cursor position against glyph cells. A logical column match alone cannot
   prove pixel alignment. Record screenshots with only nonsensitive text.
6. Repeat with legacy renderer to distinguish input bytes from native
   rendering artifacts. Open a separate upstream issue/PR if visual drift
   persists even when transmitted PTY bytes are correct.

This patch is not an upstream merge. See `docs/ACCEPTANCE.md` for the Linux
model/session/approval, disconnect and reboot tests which likewise need the
user's real environment.
