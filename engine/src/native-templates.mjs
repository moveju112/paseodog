// 사용자 프로필 대신 설치된 Mixdog 원본에서 기본 워크플로우 본문을 읽는다.
export async function nativeDefaultWorkflowBody() {
    const [{ createWorkflowPacks }, { readMarkdownDocument }, { STANDALONE_ROOT }] = await Promise.all([
        import('mixdog/src/runtime/agent/orchestrator/runtime-core/workflow/packs.mjs'),
        import('mixdog/src/runtime/shared/markdown-frontmatter.mjs'),
        import('mixdog/src/session-runtime/runtime-paths.mjs'),
    ]);
    // 두 검색 루트를 배포 원본으로 한정해 사용자 override를 템플릿으로 복제하지 않는다.
    const packs = createWorkflowPacks({
        rootDir: STANDALONE_ROOT,
        dataDir: STANDALONE_ROOT,
        readMarkdownDocument,
    });
    const pack = packs.loadWorkflowPack(undefined, 'default');
    if (!pack?.body) throw new Error('Mixdog default workflow template is unavailable');
    return pack.body;
}
