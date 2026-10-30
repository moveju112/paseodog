// 작업 방식 의무만 제거한다. 언어·승인·보안·도구 입력 계약은 그대로 둔다.
export const WORK_METHOD_RULE_PATCHES = [
    {
        file: 'src/rules/shared/05-tool-calls.md',
        blob: '39a3084892e1c74558faea9610b9b75034889275',
        edits: [[
            [
                '- Group calls already known to be needed in one response. Sequence only when',
                '  an earlier operation or result is needed to choose or safely run a later call.',
                '- For `read`, `grep`, `glob`, `git`, and `code_graph`, combine compatible targets',
                '  in one array call; split only for dependencies, differing options or scope,',
                '  or schema limits.',
                '- Order on files: enumerate only when the scope is unknown → locate every',
                '  site (known locations skip straight to the read) → one read stage over every',
                '  located site → every edit in one response → one verification. A search after',
                '  a read that could have run before it is a wasted round.',
            ].join('\n'),
            '<!-- PaseoDog: 도구 호출의 묶음·단계 순서를 강제하지 않는다. -->',
        ]],
    },
    {
        file: 'src/rules/shared/10-tool-workflow.md',
        blob: '69bad574748c021e1f9423d593d1c4aa8affd06d',
        edits: [[
            [
                '  patch from it with no surveys or history. Stop once every requested item',
                '  has its evidence; never widen past what was asked, and never ask',
                '  permission for work the request already covers.',
            ].join('\n'),
            [
                '  patch from it with no surveys or history. Never ask permission for work the',
                '  request already covers.',
            ].join('\n'),
        ]],
    },
    {
        file: 'src/rules/shared/20-research.md',
        blob: '1b3a96f6fd71b8794874222d0e5cc3f563e7f621',
        edits: [[
            '<!-- tools: web_search -->\n- Memory may be stale: web search non-Project facts before answering; when unsure, web search.',
            '<!-- PaseoDog: 프로젝트 외 모든 사실에 대한 일괄 검색 의무를 제거한다. -->',
        ]],
    },
    {
        file: 'src/rules/shared/35-implementation.md',
        blob: '893a67661fbb0f3a2025c50bc998b934d53d8944',
        edits: [[
            [
                '- Smallest implementation that meets the full contract; change code only for',
                '  an unmet requirement or demonstrated defect, never optional cleanup. Reuse',
                '  functions; no heuristics, generalization or duplicate logic.',
            ].join('\n'),
            '<!-- PaseoDog: 최소 변경·코드 재사용의 중복 지침은 사용자 규칙에 맡긴다. -->',
        ]],
    },
    {
        file: 'src/rules/shared/45-destructive.md',
        blob: '7601ab703645bcf6cf3d0531247102a52b33dfd2',
        edits: [[
            '<!-- tools: git -->\n- Separate-branch work goes into a managed worktree through `git`.',
            '<!-- PaseoDog: 별도 브랜치 작업의 managed worktree 사용을 강제하지 않는다. -->',
        ]],
    },
    {
        file: 'src/rules/shared/60-verification.md',
        blob: '88627fb0e25adf5c1b72cb492c54045b15f96024',
        edits: [[
            [
                '- No builds/lint/tests/formatters mid-flight. Finish planned scope edits,',
                '  then run required checks once in parallel. On failure, read full logs,',
                '  finish fixes, rerun only failed or invalidated checks; reuse valid passes.',
                '  Never reread your writes.',
            ].join('\n'),
            [
                '<!-- PaseoDog: 검사 시점·호출 횟수와 작성한 내용의 재확인을 제한하지 않는다. -->',
                '- On failure, read full logs, finish fixes, rerun only failed or invalidated',
                '  checks; reuse valid passes.',
            ].join('\n'),
        ]],
    },
    {
        file: 'src/rules/lead/LEAD.md',
        blob: '91c933cd454d280a26dc5dca54466af0af928c1b',
        edits: [[
            [
                'do independent work and end the turn. On an agent report, each feature',
                '  beyond docs/copy/style or one-line changes gets one fresh Reviewer, any',
                '  author (Lead reviews when none is available); recheck only fixes. Before',
                '  commit/report, check cross-feature seams and run affected suites once.',
            ].join('\n'),
            [
                'do independent work and end the turn.',
                '  <!-- PaseoDog: 기능 수정마다 Reviewer를 자동 호출하는 의무를 제거한다. -->',
                '  Before commit/report, check cross-feature seams and run affected suites once.',
            ].join('\n'),
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/tools/builtin/builtin-tools.mjs',
        blob: '9d0696ccdead926700834e8f0e706d3d71a24393',
        edits: [[
            "Read file windows or images. One call per read stage: {file_path, offset, limit} entries for every located site, never a whole large file. Content in context is never read again. Missing paths are reported, never replaced. Directories: list. Binaries: bounded hex. Rows carry no line numbers; `[lines a-b]` gives each block's range. Never count rows: before writing a line number, copy it from grep, code_graph or git diff output; otherwise cite path and symbol.",
            "Read file windows or images. Accepts {file_path, offset, limit} entries for up to 10 files; use bounded windows for large files. Missing paths are reported, never replaced. Directories: list. Binaries: bounded hex. Rows carry no line numbers; `[lines a-b]` gives each block's range. Never count rows: before writing a line number, copy it from grep, code_graph or git diff output; otherwise cite path and symbol.",
        ], [
            'Search literal/regex file contents (single-line ripgrep); returns path:line blocks with context, patch-ready. Broad reconnaissance: mode:files; locating: context:0; every pattern and scope in one call, and the anchors are the windows for one read. Symbol relations: code_graph.',
            'Search literal/regex file contents (single-line ripgrep); returns path:line blocks with context, patch-ready. Broad reconnaissance: mode:files; locating: context:0. Symbol relations: code_graph.',
        ]],
    },
];
