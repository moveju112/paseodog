import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { gitBlob } from '../scripts/patch-mixdog.mjs';
import { COMPOSER_FILE, patchedComposerSource, patchPaseoComposer, withoutWorktreeSetupTip } from '../scripts/patch-paseo-composer.mjs';
import { WHITE2_LABELS, WHITE2_OPTION, withoutWhite2Theme, withWhite2Theme } from '../scripts/patch-paseo-theme.mjs';
import { SOFT_LIGHT_EDITS, SOFT_LIGHT_SURFACE_EDITS, withoutSoftLightThemes } from '../patches/paseo-soft-light-themes.mjs';
import { withoutCollaboration } from '../patches/paseo-collaboration.mjs';
import { withoutAutoEffort } from '../patches/paseo-auto-effort.mjs';
import { withoutAgentProgress } from '../patches/paseo-agent-progress.mjs';
import { withoutSidebarToolbar } from '../patches/paseo-sidebar-toolbar.mjs';
import { withoutHelpMenu } from '../patches/paseo-help-menu.mjs';
import { withoutUsageColors } from '../patches/paseo-usage-colors.mjs';
import { withoutUsageOrder as withoutUsageOrderOnly } from '../patches/paseo-usage-order.mjs';
import { withoutUsageDonut } from '../patches/paseo-usage-donut.mjs';
import { withoutSidebarStatusShapes } from '../patches/paseo-sidebar-status-shapes.mjs';
import { withoutWorkRecords } from '../patches/paseo-work-records.mjs';
import { withoutConversationFocus } from '../patches/paseo-conversation-focus.mjs';
import { withoutExternalLinks } from '../patches/paseo-external-links.mjs';
import { withoutRelayPassword } from '../patches/paseo-relay-password.mjs';
import { withoutCompactionBuffer } from '../patches/paseo-compaction-buffer.mjs';
import { withoutOfferLink } from '../patches/paseo-offer-link.mjs';
import { withoutSettingsCorrections } from '../patches/paseo-settings-corrections.mjs';
import { withoutAgentEditorSafety } from '../patches/paseo-agent-editor-safety.mjs';
import { withoutChatUsability } from '../patches/paseo-chat-usability.mjs';
import { withoutMarkdownTable } from '../patches/paseo-markdown-table.mjs';
import { withoutDaemonUpdate } from '../patches/paseo-daemon-update.mjs';
import { withoutSettingsOrganization } from '../patches/paseo-settings-organization.mjs';
// 사이드바 쿼터 패치 해제 (도넛 -> 고정 순서, 실제 composer 체인 순서)
const withoutUsageOrder = (source) => {
    source = withoutSettingsOrganization(source);
    source = withoutDaemonUpdate(source);
    source = withoutMarkdownTable(source);
    source = withoutCompactionBuffer(withoutOfferLink(withoutSettingsCorrections(withoutAgentEditorSafety(withoutChatUsability(source)))));
    return withoutUsageOrderOnly(withoutUsageDonut(withoutSidebarStatusShapes(withoutWorkRecords(withoutExternalLinks(withoutRelayPassword(withoutConversationFocus(source)))))));
};
import { withoutHideReasoning } from '../patches/paseo-hide-reasoning.mjs';
import { withoutImportCwd } from '../patches/paseo-import-cwd.mjs';
import { withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';

const { z } = createRequire(new URL('../tools/package.json', import.meta.url))('zod');
const root = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url).pathname;
const installed = readFileSync(root + COMPOSER_FILE, 'utf8');
const original = withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(installed))))))))))));
const patched = patchedComposerSource(installed);
const lightPalette = 'const E=O({surface0:"#ffffff",surface1:"#fafafa",surface2:"#f4f4f5",surface3:"#e4e4e7",surface4:"#d4d4d8",'
    + 'surfaceDiffEmpty:"#f6f6f6",surfaceSidebar:"#f4f4f5",foreground:"#1a1a1e",foregroundMuted:"#71717a",foregroundExtraMuted:"#a1a1aa",'
    + 'border:"#e4e4e7",borderAccent:"#ececf1",accent:"#20744A",';

// 번들의 Metro 모듈 하나만 평가 (의존성 순서대로 주입 -> 모듈 exports 반환)
function evaluateModule(source, id, dependencies) {
    const end = source.indexOf('},' + id + ',['), start = source.lastIndexOf('__d(function', end) + '__d('.length;
    const exports = {};
    new Function('return ' + source.slice(start, end + 1))()(globalThis, (index) => dependencies[index], null, null, {},
        exports, dependencies.map((dependency, index) => index));
    return exports;
}

// 테마 모듈 평가 (하이라이트 색상 의존성은 빈 객체)
function themeModule(source) {
    return evaluateModule(source, 305, [{}, {}]);
}

// 실제 입력창 매핑과 안내문 스타일을 평가해 테마별 표시 값을 반환한다.
function composerPresentation(source, theme) {
    const hint = source.match(/focusHintText:\{([^}]+)\}/);
    const inputModule = source.slice(source.lastIndexOf('__d(function', hint.index), hint.index);
    const placeholder = inputModule.match(/placeholderTextColor:e\.colors\.[^}]+/)[0];
    return {
        placeholderTextColor: new Function('e', 'return ({' + placeholder + '})')(theme).placeholderTextColor,
        ...new Function('e', 'return ({' + hint[1] + '})')(theme),
    };
}

// 실제 번들의 말풍선·입력창 스타일 식을 실행해 테마별 색상과 기존 폴백을 확인한다.
function chatSurfacePresentation(source, theme) {
    const bubble = source.match(/bubble:\{backgroundColor:([^,]+),borderRadius:16/);
    const composer = source.match(/backgroundColor:([^,]+),borderWidth:e\.borderWidth\[1\],borderColor:([^,]+),borderRadius:16,paddingTop/);
    return [bubble[1], composer[1], composer[2]].map((expression) => new Function('e', `return ${expression}`)(theme));
}

// sRGB 전경·배경을 선형 휘도로 바꿔 작은 글자의 WCAG 대비를 확인한다.
function contrastRatio(foreground, background) {
    const values = [foreground, background].map((hex) => hex.slice(1).match(/../g)
        .map((channel) => parseInt(channel, 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0));
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

// 실제 설치된 zod와 번들 테마·저장 키 모듈로 앱 설정을 저장 -> 저장소 원문 -> 재로딩한 theme 값을 반환
async function persistTheme(source, theme) {
    const keys = evaluateModule(source, 3214, []);
    const omit = (value, names) => Object.fromEntries(Object.entries(value).filter(([name]) => !names.includes(name)));
    const settings = evaluateModule(source, 3128, [omit, { isSyntaxThemeId: () => true },
        { DEFAULT_USAGE_PREFERENCES: {}, UsagePreferencesSchema: z.unknown() }, {},
        { DEFAULT_SIDEBAR_ROW_ITEMS: {}, isChecksHiddenByLegacyRowItem: () => false }, { isNative: false },
        themeModule(source), { z }, keys, { migrateAppSettings: async (value) => value }]);
    const values = new Map(), cache = new Map();
    const storage = {
        getItem: async (key) => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async (key) => { values.delete(key); },
    };
    const queryClient = { getQueryData: (key) => cache.get(String(key)), setQueryData: (key, value) => cache.set(String(key), value) };
    await settings.saveAppSettings({ queryClient, deps: { storage }, updates: { theme } });
    return [JSON.parse(values.get(keys.APP_SETTINGS_KEY)).theme, (await settings.loadAppSettingsFromStorage({ storage })).theme];
}

test('White2 improves secondary contrast without changing existing themes or light backgrounds', () => {
    assert.equal(original.split(lightPalette).length, 2);
    assert.equal(patched.split(lightPalette).length, 2);
    const before = themeModule(original), after = themeModule(patched);
    assert.deepEqual(after.THEME_OPTIONS.map((option) => option.name),
        [...before.THEME_OPTIONS.map((option) => option.name), 'white2', 'neutralPearl', 'softLinen']);
    for (const [name, theme] of Object.entries(before.REGISTERED_THEMES)) {
        assert.deepEqual(after.REGISTERED_THEMES[name], theme);
    }
    assert.notEqual(after.REGISTERED_THEMES.lightWhite2, after.REGISTERED_THEMES.light);
    const colors = after.REGISTERED_THEMES.lightWhite2.colors;
    assert.deepEqual([colors.surface0, colors.surface1, colors.surface2, colors.surface3, colors.surface4, colors.surfaceSidebar,
        colors.foreground, colors.foregroundMuted, colors.border, colors.accent, after.REGISTERED_THEMES.lightWhite2.colorScheme],
    ['#ffffff', '#fafafa', '#f4f4f5', '#e4e4e7', '#d4d4d8', '#f4f4f5', '#1a1a1e', '#52525b', '#d4d4d8', '#20744A', 'light']);
    assert.equal(colors.foregroundExtraMuted, '#71717a');
    assert.equal(colors.mutedForeground, '#52525b');
    assert.equal(colors.borderAccent, '#c4c4cc');
    assert.equal(colors.accentBorder, '#c4c4cc');
    assert.equal(after.THEME_TO_UNISTYLES.white2, 'lightWhite2');
    assert.equal(after.THEME_TO_UNISTYLES.light, 'light');
    assert.equal(after.THEME_SWATCHES.white2, '#ffffff');
    assert.equal(after.getNextThemePreference('pureBlack'), 'white2');
    assert.equal(after.getNextThemePreference('white2'), 'neutralPearl');
    assert.equal(after.getNextThemePreference('neutralPearl'), 'softLinen');
    assert.equal(after.getNextThemePreference('softLinen'), 'light');
});

test('White2 fixes faint composer text while every existing theme keeps its original presentation', () => {
    const before = themeModule(original), after = themeModule(patched);
    for (const [name, theme] of Object.entries(before.REGISTERED_THEMES)) {
        assert.deepEqual(composerPresentation(patched, after.REGISTERED_THEMES[name]), composerPresentation(original, theme));
    }
    const presentation = composerPresentation(patched, after.REGISTERED_THEMES.lightWhite2);
    assert.equal(presentation.placeholderTextColor, '#71717a');
    assert.equal(presentation.color, '#52525b');
    assert.equal(presentation.opacity, 1);
});

test('White2 persists through the native settings schema and has localized labels', async () => {
    // 설정 스키마는 THEME_OPTIONS에서 파생되므로 패치 전에는 white2가 기본값으로 버려지고, 패치 후에는 유지된다.
    assert.deepEqual(await persistTheme(original, 'white2'), ['white2', 'auto']);
    assert.deepEqual(await persistTheme(patched, 'white2'), ['white2', 'white2']);
    assert.deepEqual(await persistTheme(patched, 'light'), ['light', 'light']);
    assert.deepEqual(await persistTheme(patched, 'white3'), ['white3', 'auto']);
    assert.equal(patched.split(WHITE2_OPTION).length, 2);
    const labels = [...patched.matchAll(/pureBlack:"[^"]*",white2:("[^"]*"),neutralPearl:"[^"]*",softLinen:"[^"]*",auto:"/g)].map((match) => JSON.parse(match[1]));
    assert.equal(labels.length, WHITE2_LABELS.length);
    assert.equal(labels.filter((label) => label === '화이트2').length, 1);
    assert.equal(patched.includes('white2:"\\ud654\\uc774\\ud2b82",neutralPearl:"\\ub274\\ud2b8\\ub7f4 \\ud384",softLinen:"\\uc18c\\ud504\\ud2b8 \\ub9b0\\ub128",auto:"'), true);
});

test('soft light themes persist, reproduce approved palettes and preserve existing chat surfaces', async () => {
    const previous = withoutSoftLightThemes(withoutSoftLightThemes(installed, SOFT_LIGHT_SURFACE_EDITS));
    const before = themeModule(previous), after = themeModule(patched);
    for (const [name, theme] of Object.entries(before.REGISTERED_THEMES)) {
        assert.deepEqual(chatSurfacePresentation(patched, after.REGISTERED_THEMES[name]), chatSurfacePresentation(previous, theme));
    }
    for (const [name, registered, background, foreground, bubble, composer, border, accent] of [
        ['neutralPearl', 'lightNeutralPearl', '#F3F4F4', '#343A3B', '#E3EAE8', '#F7F8F7', '#A6B2AF', '#42675F'],
        ['softLinen', 'lightSoftLinen', '#F4F1EC', '#3B3732', '#E7E1D7', '#F8F5F0', '#B4A797', '#756049'],
    ]) {
        const theme = after.REGISTERED_THEMES[registered], colors = theme.colors;
        assert.deepEqual(await persistTheme(patched, name), [name, name]);
        assert.equal(after.THEME_TO_UNISTYLES[name], registered);
        assert.equal(after.THEME_SWATCHES[name], background);
        assert.deepEqual([colors.surface0, colors.foreground, colors.accent, colors.tabSelectedForeground], [background, foreground, accent, accent]);
        assert.deepEqual(chatSurfacePresentation(patched, theme), [bubble, composer, border]);
        assert.equal(composerPresentation(patched, theme).placeholderTextColor, colors.foregroundMuted);
        assert.equal(composerPresentation(patched, theme).opacity, 1);
        assert.equal(colors.terminal.background, background);
        assert.equal(colors.conversationBackground, background);
        for (const [text, surface] of [
            [foreground, background], [foreground, bubble], [colors.foregroundMuted, colors.surface2],
            [colors.foregroundMuted, composer], [accent, '#FFFFFF'],
        ]) assert.ok(contrastRatio(text, surface) >= 4.5, `${name}: ${text}/${surface}`);
    }
    for (const [, afterEdit] of [...SOFT_LIGHT_EDITS, ...SOFT_LIGHT_SURFACE_EDITS]) {
        assert.throws(() => patchedComposerSource(patched.replace(afterEdit, '')), /Partial Paseo/);
    }
    assert.equal(patchedComposerSource(withoutSoftLightThemes(patched)), patched);
});

test('White2 keeps the strict upstream gate and is idempotent', () => {
    assert.equal(['bdc4b8ed97dbccc7e6215d7f2f7be2e420fce895', '35606b3c900c220239427937d2aa55f0860f1bb4'].includes(gitBlob(original)), true);
    assert.equal(patchedComposerSource(patched), patched);
    assert.equal(patchedComposerSource(original), patched);
    assert.equal(withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(patched)))))))))))), original);
    assert.throws(() => withWhite2Theme(patched), /anchor mismatch/);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
    const partial = patched.replace(WHITE2_OPTION, '').replace('},],ee="plugin"', '}],ee="plugin"');
    assert.throws(() => patchedComposerSource(partial), /Partial Paseo (White2|soft light)/);
});

test('the original White2 bundle upgrades without weakening the reviewed upstream gate', () => {
    const legacy = patched
        .replace(WHITE2_OPTION, '{name:"white2",group:"variant",unistylesName:"lightWhite2",theme:q(E),swatch:"#ffffff"}')
        .replace('e.colors.composerPlaceholder??', '')
        .replace('e.colors.composerFocusHintOpacity??', '');
    assert.equal(withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(legacy)))))))))))), original);
    assert.equal(patchedComposerSource(legacy), patched);
    assert.throws(() => patchedComposerSource(legacy + '// drift'), /hash mismatch/);
});

test('composer check rejects stale precompressed web bundles', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-theme-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, COMPOSER_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{"version":"0.11.4"}');
    writeFileSync(path, patched);
    // 빠른 압축 수준을 써도 서버가 제공하는 복원 결과만 비교한다.
    writeFileSync(path + '.br', brotliCompressSync(patched, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 } }));
    writeFileSync(path + '.gz', gzipSync(original, { level: 1 }));
    assert.throws(() => patchPaseoComposer(directory, { check: true }), /precompressed bundle is stale/);
    writeFileSync(path + '.gz', gzipSync(patched, { level: 1 }));
    patchPaseoComposer(directory, { check: true });
});
