# Upstream compatibility record

Mixdog's current compatibility target is the published npm `mixdog@1.2.6` artifact.
The original Paseo review below remains unchanged. Source review and local checks
do not establish real-account or mobile acceptance.

| Component | Version | Git commit |
|---|---|---|
| Paseo / plugin SDK | 0.11.4 | npm artifacts; custom Android base `dc5b02f` |
| Mixdog | 1.2.6 | npm artifact; compared against tag `v1.2.6` |

## Security dependency overrides — 2026-10-19

Paseo CLI/server/SDK base remains `0.11.4`; Mixdog remains `1.2.6`.
`tools/package.json` overrides only the server's affected transitive dependencies:

| Package | Fixed version | Advisory |
|---|---|---|
| `@modelcontextprotocol/sdk` | `1.31.0` | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) |
| `ai` | `5.0.207` (provider-utils `3.0.28`, gateway `2.0.106`) | [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8) |
| `markdown-it` | `14.3.1` | [GHSA-253c-mchw-3w2r](https://github.com/advisories/GHSA-253c-mchw-3w2r) |
| `linkify-it` | `5.0.2` | [GHSA-v245-v573-v5vm](https://github.com/advisories/GHSA-v245-v573-v5vm) |
| `uuid` | `11.1.1` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

The markdown update removes `argparse@1` and its vulnerable `sprintf-js` dependency.
These are dependency-level fixes, not acceptance of a new Paseo base or changes to
the reviewed source hashes. Do not use audit's forced downgrade to CLI `0.4.0`.

## Primary source references

The rc.7 adapter exposes existing Mixdog 1.2.6 native session routes
(`setRoute`, session-only, same durable ID), cold inheritance
(`inheritToNewSession`), turn change review/Undo/Redo, and model-message reads.
It also exposes dedicated-profile MCP/OAuth, skills and plugin administration.
These are adapter connections, not copied inference implementations or a pin change.
Manual compact now uses the native chat options (`recoverAgent: true`).
Local context-tuning patch: the reviewed native `set-route.mjs` original blob
`a36ce4b5bfec0a62715fa70c6e8deed6126537ca` now uses its existing
`updateSessionInPlace` path when a same-model selection changes the context window.
Without this patch the selected route changed but the active session retained its
old window. `scripts/patch-mixdog.mjs` gates and applies the change; no pin is bypassed.
Quota continuation requires a typed, settled exhaustion; an explicitly scheduled
continuation consumes its journal reservation before starting and never restores
automatically after a disconnect. It sends a continuation, not the original command.

Local Paseo agents settings navigation: `patches/paseo-agents-settings.mjs`
restores the existing `agents` host-settings entry through the composer patch's
Paseo 0.11.4 version and original-blob gates and existing install/desktop paths.
The same entry is restored in the shared Android app source. Existing settings
pages, configuration values and permissions are unchanged on Android,
Linux/Windows desktop and web. Source verification does not establish installed
app or device acceptance.

Linux desktop packaging also installs the existing PaseoDog PNG at
`resources/icon.png`, the packaged Electron window icon path. This reuses the
Android branding asset without changing upstream window logic, launcher
settings, native Android icons or Windows executable resources.

The installed Linux desktop's newer `index-92699df43a283bb08831cc9d2fb07982.js`
is separately gated at original Git blob `4c53bd249bb6ac1cc3ebdf0a32a55bf9aaa7ed35`
by `patches/paseo-desktop-settings.mjs`; its existing reasoning setting uses
the same answer-only projection and its host menu restores the existing agents
route. This does not accept that bundle as a server upstream replacement.

Local Mixdog output-style patch: `scripts/patch-mixdog.mjs` adds an explicit
`default` selection that injects no output-style header, shared formatting,
depth rules or formatting-precedence directive. Existing style selections and
the unset-setting fallback remain unchanged. The native catalog and prompt
builder are shared by Android, Linux, Windows and web; this change does not
require platform-specific builds or overwrite the operator's selected style.

Local effort usage attribution: `patches/effort-usage.mjs`, applied through the
Mixdog 1.2.6 exact-blob gates in `scripts/patch-mixdog.mjs`, extends request
accounting and the existing route signature with effort and agent attribution.
Mid-conversation projections update the recorded effort; abandoned attempts keep
their own snapshot. Existing records are not rewritten or inferred. Worker reads
use retained request events and existing daily source precedence; historical
summary-only periods may therefore lack effort detail. This is local request
metadata, not provider-reported reasoning-token or billing-tier confirmation.

Local Paseo 0.11.4 agent-message provenance patch:
`scripts/patch-paseo-agent-messages.mjs` gates the actual MCP, dispatch,
provider-transport and SDK protocol blobs. Authenticated MCP caller identity
travels separately from prompt text. PaseoDog stores these messages as
notifications and feeds Mixdog's native task-notification path, not explicit
human prompts/skill selection. Internal delivery never replaces an active
turn, clears permissions, dispatches slash commands or retries uncertain sends.
Existing history is not rewritten. Human messages retain their original path.

Current Mixdog source: https://registry.npmjs.org/mixdog/-/mixdog-1.2.6.tgz

The commit links below retain the original `1.0.12` integration references; the
current runtime, callback bridge and pre-tool policy were reviewed in the npm
artifact. The retained turn-run fixture and blob gate below target `1.2.6`.

- Paseo provider contract: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/packages/plugin/src/server/provider.ts
- Provider guide: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/plugins/providers.md
- Plugin lifecycle and trust: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/docs/plugins.md
- Foreground daemon, authentication and connectivity configuration: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/configuration.md
- Command argv and provider options: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/docs/custom-providers.md
- SSH/control commands: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/cli.md
- Mixdog runtime facade: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/runtime-core.mjs
- Native turn runner: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/turn/turn-run.mjs
- Native session hook: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/session-hooks.mjs
- Native pre-tool policy: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/runtime/agent/orchestrator/session/loop/tool-exec/before-hook.mjs
- Native MCP schema: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/mcp-glue/server-input.mjs
- Stream reset semantics: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/repl/stream-sink.mjs

## Reviewed host boundary patches

PaseoDog의 즉시 지시는 `options.paseodogSteering === true`로 표시한 영속 입력만
도구 배치 뒤 다음 모델 요청 전에 전달한다. `hostSteering`을 켠 소유 턴에만 적용하고,
일반 대기열 입력은 기존 terminal 경계를 유지한다. 원본 게이트:
`pending-messages.mjs` = `40722271524f52ee83df0013c40e81aaf2a73265`,
`ask-turn-steering-drain.mjs` = `bdc078312e2328d4095c392683fb9e504bb8d8f6`.

File: `src/session-runtime/turn/turn-run.mjs`.
Original Git blob: `6de5147ccdce6c9b3aa5f48dc740af439834b7b1`.
The exact original is retained as `tests/fixtures/upstream-turn-run.mjs.txt` under its
upstream Apache-2.0 license. A test computes Git's actual blob hash of that fixture.

Insertion follows `dispatchPromptSubmit(turn, session0, prompt, options)`:

```js
// PaseoDog host-policy boundary v1 (local Apache-2.0 modification).
if (typeof options.beforeSessionAsk === 'function') {
    await options.beforeSessionAsk(session0);
}
```

The patcher checks package version, exact original hash, one insertion anchor and
idempotency. It changes only an installed local dependency file and never pushes an
upstream commit. `--check` refuses missing/changed patches. No bypass flag is included.
The source has been statically reviewed and the patched original runner tested with
mocked helpers; downstream full engine behavior still requires live validation.

`scripts/patch-mixdog.mjs` also pins these `1.2.6` source blobs:

| File under `src/` | Original Git blob | Purpose |
|---|---|---|
| `session-runtime/runtime-core.mjs` | `14ae394742a849f5cfd5bdc18123d9779ec6a7d3` | Pass the host agent surface through boot |
| `session-runtime/boot/tools.mjs` | `704c7bcc84c8d6a52b0d13ea7412ba287d40b9fd` | Inject the native agent sessionSurface and retain host config during planning |
| `session-runtime/boot/providers.mjs` | `34fc9fec9d09ac3b21d9a88b8e5468f3927992f3` | Preserve explicitly injected host config across lazy-secret/config reloads |
| `session-runtime/turn/turn-run/ask-callbacks.mjs` | `05b64099a27c0aae0e86be27ee493407661e3361` | Carry host completion ownership while retaining `onStreamItemStart` |
| `runtime/agent/orchestrator/session/manager/ask-session.mjs` | `40a774b8654fbb7ac7a658fc9020fc16cf9c75af` | Suppress unawaited follow-up asks for host-managed turns |

All files are validated before any write. Partial or drifted patches are rejected.
The exact previously reviewed one-edit `boot/tools.mjs` patch can be upgraded to the
current two-edit form; arbitrary partial combinations remain rejected.
The native scheduler is unchanged. `npm run test:native` exercises the installed
runtime through a scripted localhost HTTP provider, including real read-tool execution
and denied/canceled shell calls. This does not substitute for subscription-model or
Paseo app acceptance.

## Upgrade procedure

### Selected Paseo backports

The CLI/SDK stay on stable `0.11.4`; the app does not adopt the beta navigation overhaul.
`tools` postinstall runs two independent, version- and full-source-hash-gated patches:

- `scripts/patch-paseo-cli.mjs`: PR [#6607](https://github.com/getpaseo/paseo/pull/6607), wait for permission-response acknowledgement before reporting success.
- `scripts/patch-paseo-terminal.mjs`: PR [#6452](https://github.com/getpaseo/paseo/pull/6452), serialize wide-character continuation cells as `""` in both grid and scrollback. No new protocol fields or input changes.

The custom Android source also contains the client half of #6452, reconnect-stream reconciliation [#7256](https://github.com/getpaseo/paseo/pull/7256), and terminal-copy fixes [#7254](https://github.com/getpaseo/paseo/pull/7254) / [#7260](https://github.com/getpaseo/paseo/pull/7260). Rebuild its protocol package before the APK. These fixes do not replace the Android input-order patch or establish physical Samsung IME acceptance.

### Local Paseo patches

PaseoDog-origin changes to Paseo `0.11.4` code; not upstream PRs and never sent upstream.
`scripts/install.sh` applies each and then runs its `--check`; all are version- and source-blob-gated.

- `android/packages/app/src/components/context-window-{meter,details}.tsx`, `composer/index.tsx` (+ `contextWindow.compact` in all nine locales): local "Compact context" button in the context window details, matching the Mixdog desktop context popover. It appears only when the agent's provider lists the `compact` command, sends the existing `/compact` prompt (provider `recoverAgent: true` path), and is disabled while a turn is running or the host is disconnected. Shown in the desktop/web hover card and the compact-screen sheet (Android/iOS phones, narrow web); the native wide-screen tooltip takes no presses, so it has no button there, like its usage Refresh. Source-only change, not an APK/desktop build or installed-client update.
- `patches/paseo-import-cwd.mjs`: local, through the existing exact-blob-gated `scripts/patch-paseo-composer.mjs` install/desktop paths; the shared new-workspace import entry passes its selected source directory to `useImportSession`, which already scopes provider snapshots and recent-session requests by `cwd`. No project context retains host-wide import; existing workspace-scoped import and explicit "Show all" behavior are unchanged. Applies equally to Linux/Windows desktop and web. The equivalent change is applied in `android/packages/app/src/screens/new-workspace-screen.tsx`; `node scripts/patch-paseo-import-cwd.mjs --check android` checks its reviewed original Git blob `c919ab476d43b4af246e43ef2a6defda26992852` and applied patch. This source change is not an APK build, installation or device acceptance.
- PaseoDog branding replaces the Paseo butterfly mark in the shared app and desktop sources. `startup-splash-screen.tsx` web/desktop splash shows the PaseoDog icon under the same shimmer instead of a CSS mask of the butterfly path. The `paseo` tool-call icon uses `PaseodogLogo`, and `components/icons/paseo-logo.tsx` is removed. Favicons (plain and running/attention dots in the original 18px corner position and colors), `notification-icon.png`, PWA/apple-touch icons, `icon.png`, desktop `icon-dev.png` and `icon.icns` are regenerated from `paseodog-icon.png`. Unreferenced butterfly/favicon SVGs, `splash-icon.png` and `android-icon-foreground.png` are deleted. The daemon-served npm web-ui bundle is not changed.
- `android/packages/app/src/screens/workspace/workspace-tab-trailing-accessory.tsx`: local; compact tab-switcher rows have no direct close (X) button. Closing stays in each row's "…" actions menu, and the unused `workspace.tabs.menu.closeFor` key is removed from all nine locales.
- `android/packages/app/src/screens/workspace/workspace-screen.tsx`: local compact tab-switcher header action uses the shared sheet header and button to close the switcher and open a new agent draft in the current workspace, preserving existing sessions. Applies to Android and compact web/Linux/Windows layouts built from this shared source; wide desktop keeps its existing new-tab controls. Source-only change, not an APK build or installed-client update.
- `android/packages/app/src/components/sidebar/sidebar-recent-sessions.tsx` (+ `utils/recent-sessions.ts`, `stores/recent-sessions-store.ts`, `components/left-sidebar.tsx`, `sidebar.recentSessions` i18n keys): local "Recent" section in the fixed sidebar footer, directly above the usage rows (its rows scroll within about six rows so the workspace list keeps its height), showing top-level, unarchived sessions whose existing `lastUserMessageAt` falls within a persisted 15m/1h/today window (default 1h), newest first; a row opens the session through the existing `navigateToAgent` path (compact layouts close the sidebar first). Shared source for Android and Linux/Windows desktop and web builds from this tree; the daemon-served npm web-ui bundle is not patched. Source-only change, not an APK/desktop build or installed-client update.
- `android/packages/app/src/components/synced-loader.native.tsx`: local native-only `SyncedLoader` override; the in-flight turn working indicator renders the OS `ActivityIndicator` ring (stopped while its retained panel is hidden) because the Reanimated UI-thread dot clock appeared frozen on Android. Web and Linux/Windows desktop keep the shared dot loader in `synced-loader.tsx`, which already animates there. Source-only change, not an APK build or device acceptance.
- `android/packages/app/metro.config.cjs` + `android/packages/app/src/hermes/ws-outbound-aot.ts`: local, Hermes (non-web) bundles only. When `packages/protocol/dist/validation/ws-outbound.js` imports the zod-aot generated `generated/validation/ws-outbound.aot.js`, Metro resolves it to a shim that re-exports the source Zod `WSOutboundMessageSchema` from `@getpaseo/protocol/messages`. The generated validator puts about 87k lines in one function (`safeParse_WSOutboundMessageSchema`). `hermesc -O` did not finish that module alone within 25 min and used about 17GB in the release build; the rest of the bundle compiled in 13.7 s. With the shim, the full Android bundle is 37.5MB and hermesc takes 12.7 s with 1.4GB peak RSS. zod-aot output is tested against the same source schema, so validation results are the same; client-side message validation on Hermes now uses runtime Zod, and its on-device speed is not yet measured. Web and Linux/Windows desktop (V8) keep the generated validator. Source-only change, not an APK build or device acceptance.
- `android/packages/app/modules/paseo-diff-prototype/android/build.gradle`: local; `ndk.abiFilters` follows `reactNativeArchitectures`, as in other RN native libraries. Without it, AGP compiled the module for all four ABIs even for an arm64-only build. The new config plugin `android/packages/app/plugins/with-android-architectures.js` (registered in `app.config.js`, test `tests/update-packaging.test.mjs`) makes prebuild write `reactNativeArchitectures=arm64-v8a`; other ABIs need an explicit `-PreactNativeArchitectures=...`. The generated (gitignored) `android/packages/app/android/gradle.properties` already holds the same value. It also gets the `app.config.js` expo-build-properties release flags (minify, shrink resources, bundle compression), which the stale prebuild output had dropped. Build configuration only; app behavior is unchanged.
- `android/`: existing PaseoDog-branded Android source imported from the local checkout based on upstream commit `dc5b02f7d7c120baea380d76def8b968020d8823`, preserving its pre-existing local changes. Native equivalents of the desktop White2 theme, analysis toolbar entry, help-menu cleanup, quota tone colors, fixed sidebar quota order/weekly `7D` label, live-session/draft Auto effort, host-wide collaboration, and current-parent child-job progress are maintained in `android/packages/app/src/`. Shared inference, authorization, images, steering, settings and usage RPCs remain daemon/provider-owned. This source import does not change the server pin or establish signed APK distribution/device acceptance.
- `patches/paseo-help-menu.mjs`: local, via `scripts/patch-paseo-composer.mjs` and its reviewed Paseo 0.11.4 server/desktop blobs; omit only the sidebar help menu's report heading, separator, Discord and GitHub issue items. Keep shortcuts, news, diagnostics and version information.
- `scripts/patch-paseo-composer.mjs`: local, via the same reviewed server/desktop blobs; suppress the sidebar worktree setup promotion regardless of project configuration while retaining manual project settings. Android omits the matching callout source from its root layout.
- `patches/paseo-usage-colors.mjs`: local, via the same reviewed composer blobs; let quiet sidebar meters reuse `UsageMeter` tone colors, including the existing `windowTone` thresholds (`>=70` warning, `>90` danger). Preserve quota values, fill widths and responsive layout.
- `patches/paseo-usage-order.mjs`: local, via the same reviewed composer blobs; the sidebar quota summary (`resolvePinnedUsage`) orders sources Codex, Claude, then remaining `sourceId` and report id, instead of report/update arrival order, and shows only the exact weekly short name `wk` (host SDK `windowFromReportedDuration` 604800 s and built-in weekly sources) as `7D`. Quota values, window ids/semantics, accessible labels, `5H`/`5h` and scoped labels stay unchanged; the usage dashboard order is not changed. Android applies the same rule in `android/packages/app/src/usage/pinned.ts`.
- `patches/paseo-usage-donut.mjs`: local, via the same reviewed composer blobs; usage options add `Sidebar style` (`Bars` default, `Donuts`), stored device-locally as `usage.sidebarStyle` only when `donut` (missing/malformed reads as bars). Donuts draw each pinned sidebar window as a 30 px ring filled to the displayed percent with the existing `windowTone` colors, the source icon and short name inside and the reset countdown below (`H:MM` under a day, `ND` otherwise, `--:--` unknown; usage_widget format, refreshed every 30 s). `resolvePinnedUsage` windows additionally carry `resetsAt`. Shared app source: `android/packages/app/src/usage/donut*.ts(x)`, `preferences.ts`, `display.ts`, `options.tsx`, `pinned.ts`, `sidebar-item.tsx`.
- `patches/paseo-hide-reasoning.mjs`: local, via the same reviewed composer blobs; the persisted `hideReasoning` setting (default off) now shows only the last assistant message after the last tool in each completed turn, retaining all its Markdown blocks. If every row of the loaded timeline window would be hidden (a completed turn ending in tools whose user message is on an older page), the last completed assistant block in that window stays visible instead of an empty chat. `withCurrentAnswerOnly` upgrades the previous `answerOnlyRows` source in already-patched web-ui and desktop bundles before the existing original-blob gates. Active-turn assistant text, reasoning, tools, informational progress, todos and compaction rows are removed before grouping/layout, leaving no hidden-row spacing. User messages, warnings/errors, plugin rows and permission/question prompts remain; model reasoning, native history and source arrays are unchanged. Exact previous patch output is normalized through the existing original-blob gate. Nine locale descriptions and the shared Android/Linux/Windows/web presentation source have matching semantics. This is a source change, not installed-app or device acceptance.
- `scripts/desktop-release.mjs`: local, exact upstream updater blob `31a64cc1b2868408187f4a029f954860401a4812`; keep upstream automatic overwrite blocked and explicitly report `updateMode: "manual"`. Shared desktop renderer sources display manual-update guidance instead of treating disabled checks as proof the installed app is current. Main-process and renderer changes must be shipped together on applicable desktop platforms. Since `1.0.0-rc.7.11032` the Linux desktop app is built from `android/` source as a `.deb` with the unpatched electron-updater (`electron-builder.yml` publish `moveju112/paseodog`). Each release that carries it also publishes `latest-linux.yml`, so the settings screen can check, download and install updates. This script's in-place updater block applies only to earlier installs patched with `paseodog desktop-update`.
- `scripts/patch-paseo-usage.mjs`: local, reviewed server `plugins/builtin/index.js` blob `d94adc58d404341bbc622f71920779a652efd2dc`; replace built-in Claude usage with PaseoDog's Mixdog source and omit the unused Copilot usage card. Keep Codex usage and all provider registrations unchanged.
- `scripts/patch-paseo-steer.mjs`: local, server `agent/plugin-provider.js`; unsupported PaseoDog steering points to the queue and cannot replace the active turn.
- `scripts/patch-paseo-workspace-name.mjs`: local, reviewed server blobs `agent/create-agent-title.js` `353ee3d0d6088f6af6401c502aef8b728c531efe`, `workspace-auto-name.js` `aadeb609cb9da8dc776a23052574cd7e8aee7a11`, `session/workspace-provisioning/workspace-provisioning-service.js` `408745af59cab48e3127c4ce6e710164518e614a`; a new directory or worktree workspace without an explicit title is titled with the project display name (`resolveProjectDisplayName`: custom name, else project name). The first prompt no longer seeds the workspace title, directory workspaces make no AI naming call, and the worktree first-agent AI result only renames the placeholder branch, never the workspace title. Explicit create titles and later renames are kept; agent/session titles are unchanged. The daemon owns workspace names, so Android, desktop (Linux/Windows) and web clients need no client change.
- `scripts/patch-paseo-composer.mjs`: local, reviewed 0.11.4 server/desktop composer blobs (`bdc4b8ed97dbccc7e6215d7f2f7be2e420fce895`, `35606b3c900c220239427937d2aa55f0860f1bb4`); preserve native steering/attachments/queues and append `patches/paseo-collaboration.mjs` beside permission controls. SDK composer pills occupy the separate track bar; session config would misrepresent the existing host-wide setting. The orchestration control is an `OCHE` trigger (upstream `AgentControlTrigger`, lucide `Users` icon) that opens the upstream `Combobox`; the on/off switch for 에이전트 협업 (on = `swarm`, off = 단독 실행 `none`) is inside that menu, which also states the host-wide, next-request, approval-unchanged scope. It calls `paseodog-provider` `engine-controls` (`none`/`swarm`) through one shared per-host state, keeps the menu open after a toggle, does not retry an uncertain save (the next press only re-reads), applies to all host sessions at their next request, and never changes permissions or enables agents. Legacy saved `focused`/`balanced` normalize to `swarm`; new requests reject them. `patches/paseo-agent-progress.mjs` (stripped before the same blob gate, applied before collaboration/White2) adds a child-job progress pill to the separate reviewed `AgentTracks` track-bar module immediately before `WorkspaceDiffStatPill` (track bar above the input, upstream `ComposerTrackPill`/`ComposerTrackRow`/`composerPillStyles`). It polls `engine-status` through the host client only while a PaseoDog agent's composer is mounted and the page is visible (shared per host, `createLiveMonitor`, no overlapping reads), matches the parent by the persistence `bridgeId`, and counts running/approval-waiting/queued jobs with Mixdog's statusline classification; idle or terminal jobs render nothing. SDK `addComposerPill` was not used because it needs per-agent imperative registration with a string label and the client context cannot enumerate agents. `patches/paseo-sidebar-toolbar.mjs` (stripped before the same blob gate, applied first) drops only the `paseodog-provider` sidebar footer item from the quota rows and renders it through the upstream `useSidebarNavItems("footer")`/`PluginSidebarItem` after the hosts button in the bottom-left toolbar; the SDK has no toolbar placement. The collaboration switch is in both the existing-session `AgentControls` and the new-agent `DraftAgentControls` (the draft finds the host client through the session store by `modelSelectorServerId`); the third (OCHE) version strips either exact previous install (v1 live-only switch, v2 live+draft switch; both SHA-256 pinned in the module, v2 matched against the installed bundles) before the blob gate. `patches/paseo-auto-effort.mjs` (stripped before the same blob gate, applied after agent progress) wraps the shared control bar in both composers and adds a first Effort entry with a different scope per composer. New-agent composer: '자동 추론 (호스트 기본)' reads/writes the host Main `route.autoEffort` through `engine-controls`, offered only when the autoEffort module is supported and enabled and the model has effort levels; a manual level clears the host default first and reaches the draft selection only after that save is confirmed; uncertain saves are not replayed. Open session: the current `agentId` reaches the wrapper through a context provider placed after the compiler-cached `Co` value in `AgentControls` (fresh every render, no cache slot or hook added), so a cached control bar never writes to a previous agent and save state is keyed per agent; '자동 추론 (이 세션)' appears only when the session config carries the real `autoEffort` toggle setting (agent `features`), never from the host value; that toggle moves from the feature list into the Effort list. Auto calls the SDK `setAgentFeature(agentId,'autoEffort',true)` (daemon → `session.configure {settings:{autoEffort:true}}`); a manual level keeps the original `setAgentThinkingOption` path (→ `{thinkingOption}`), which the provider applies atomically with session-only `autoEffort:false`. Neither writes the host route or the client feature preference; the displayed state changes only from the daemon's next session config, and a rejected save (busy session, engine failure) shows a failure label without retry. The patch also removes the duplicate `PaseodogAutoEffort` rows (model selector, compact sheet) and the token-settings Auto-Effort switch. No unchecked blobs or installed-app mutation.
- `scripts/patch-paseo-theme.mjs`: local, applied through the composer patch; add a White2 theme option without changing the existing light palette.

Dependency audit remains unresolved: the installed stable tools reported 5 high-severity entries and plugin development dependencies reported 15, including inherited entries. No automatic audit fix or major dependency substitution is applied. This release is not a security or production-acceptance certification.

Run `npm run upstream:check` to compare the pinned Mixdog, Paseo CLI and Paseo SDK
with npm's latest releases. This is read-only: it validates lockfile/pin agreement
and reports differences, not compatibility or automatic upgrades. Registry failures
fail the command rather than reporting that the installation is current.

Keep inference features in Mixdog and client/daemon features in Paseo. Do not copy
their implementations into the adapter. Review one upstream component at a time;
upgrade the Paseo CLI and SDK together. Preserve unrelated local changes.

1. Stop the daemon and back up private data outside the source tree.
2. Review native callbacks, before-tool enforcement, resume ownership, session storage,
   stream/result shapes and the current Paseo provider contract.
3. Update direct pins and verified lockfiles together. Review npm lifecycle scripts.
4. Regenerate the retained fixture and patch hash only from the inspected upstream file.
5. Run syntax/unit tests, actual SDK typecheck, actual engine install and live smoke.
6. Complete real approval/denial, interruption, reconnect and mobile acceptance tests.
7. Record new versions, hashes and execution evidence before removing the RC label.

Steps involving service changes, account calls or deployment need separate operator
approval. Source/dependency work and local tests can be prepared without restarting
the daemon. Do not run `scripts/install.sh` merely to check an upgrade: it changes
configuration and starts/reloads the daemon.

For Mixdog, port only the hash-locked host callback and review approval, cancellation,
resume and context ownership. If upstream supplies an equivalent supported callback,
replace the local patches only after the same regression tests and `npm run test:native`
pass. Re-review child approval, completion ownership and cancellation on every upgrade;
never drop those gates merely because a new release changed an anchor.

For Paseo, review `plugin/server/provider.ts` and `plugin/server/connection.mjs`
against the installed SDK; test streaming, permissions, reconnect and persistence.
The optional Android terminal source patch is separate from the npm daemon/SDK:
review its blob gate independently, and remove it when an upstream fix is verified.
Never apply an old patch to a new source by changing only its hash.

PaseoDog does not claim original benchmark savings. The integration's policy choices,
model configuration and disabled capabilities change workload behavior. Measure.
