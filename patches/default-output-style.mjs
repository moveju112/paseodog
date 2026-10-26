// Local PaseoDog patch: explicit default adds no output-style instructions; absent settings remain simple.
export const DEFAULT_OUTPUT_STYLE_PATCHES = [
    {
        file: 'src/lib/output-style-meta.cjs',
        blob: '4c0c7c69b029c9638a533ff9900e68d375cfdd93',
        edits: [[
            "const DEFAULT_OUTPUT_STYLE_ID = 'simple';",
            "const DEFAULT_OUTPUT_STYLE_ID = 'simple';\n// 명시적 default는 파일·공통 형식 지시를 읽지 않는 가상 스타일이다.\nconst NO_OUTPUT_STYLE = Object.freeze({ id: 'default', label: 'Default', description: 'No output style instructions', aliases: Object.freeze([]), keepSharedFormat: false });",
        ], [
            "const OUTPUT_STYLE_ORDER = ['detailed', 'simple', 'minimal', 'extreme-minimal'];",
            "const OUTPUT_STYLE_ORDER = ['default', 'detailed', 'simple', 'minimal', 'extreme-minimal'];",
        ], [
            'module.exports = {\n  DEFAULT_OUTPUT_STYLE_ID,',
            'module.exports = {\n  NO_OUTPUT_STYLE,\n  DEFAULT_OUTPUT_STYLE_ID,',
        ]],
    },
    {
        file: 'src/session-runtime/output-styles.mjs',
        blob: '6bb18ed723da356da3f3d427092bdf9eff913694',
        edits: [[
            '  DEFAULT_OUTPUT_STYLE_ID,\n',
            '  DEFAULT_OUTPUT_STYLE_ID,\n  NO_OUTPUT_STYLE,\n',
        ], [
            '  return sortOutputStyles([...byId.values()]);',
            "  // 예약된 default는 사용자 파일로 덮어쓰지 않고 항상 선택 가능하게 유지한다.\n  byId.set(NO_OUTPUT_STYLE.id, { id: NO_OUTPUT_STYLE.id, label: NO_OUTPUT_STYLE.label, description: NO_OUTPUT_STYLE.description, aliases: NO_OUTPUT_STYLE.aliases, source: 'builtin' });\n  return sortOutputStyles([...byId.values()]);",
        ]],
    },
    {
        file: 'src/lib/rules-builder.cjs',
        blob: '6e08d0968a47dd554e5fbb395416210741e4a816',
        edits: [[
            '  DEFAULT_OUTPUT_STYLE_ID,\n',
            '  DEFAULT_OUTPUT_STYLE_ID,\n  NO_OUTPUT_STYLE,\n',
        ], [
            '  return sortOutputStyles([...byId.values()]);',
            "  // 카탈로그와 동일한 예약 스타일로 파일·별칭 충돌을 막는다.\n  byId.set(NO_OUTPUT_STYLE.id, NO_OUTPUT_STYLE);\n  return sortOutputStyles([...byId.values()]);",
        ], [
            "  if (!style) return '';",
            "  if (!style || style.id === NO_OUTPUT_STYLE.id) return '';",
        ]],
    },
];
