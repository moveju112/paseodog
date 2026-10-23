// 로컬 패치: Paseo 0.11.4 검토 번들에 White2·호스트 전체 협업 스위치·현재 세션 하위 작업 진행 알약·하단 도구줄 분석 아이콘·사이드바 쿼터 고정 순서·사이드바 쿼터 도넛 표시 옵션·채팅 추론 숨기기 설정을 추가하고 워크트리 설정 팁·도움말 문제 신고 묶음을 뺀다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import { gitBlob } from './patch-mixdog.mjs';
import { withWhite2Theme, withoutWhite2Theme } from './patch-paseo-theme.mjs';
import { withCollaboration, withoutCollaboration } from '../patches/paseo-collaboration.mjs';
import { withAgentProgress, withoutAgentProgress } from '../patches/paseo-agent-progress.mjs';
import { withSidebarToolbar, withoutSidebarToolbar } from '../patches/paseo-sidebar-toolbar.mjs';
import { withAutoEffort, withoutAutoEffort } from '../patches/paseo-auto-effort.mjs';
import { withHelpMenu, withoutHelpMenu } from '../patches/paseo-help-menu.mjs';
import { withUsageColors, withoutUsageColors } from '../patches/paseo-usage-colors.mjs';
import { withUsageOrder, withoutUsageOrder } from '../patches/paseo-usage-order.mjs';
import { withUsageDonut, withoutUsageDonut } from '../patches/paseo-usage-donut.mjs';
import { withHideReasoning, withoutHideReasoning } from '../patches/paseo-hide-reasoning.mjs';
import { withImportCwd, withoutImportCwd } from '../patches/paseo-import-cwd.mjs';
import { withAgentsSettings, withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';
import { withSidebarStatusShapes, withoutSidebarStatusShapes } from '../patches/paseo-sidebar-status-shapes.mjs';
import { withWorkRecords, withoutWorkRecords } from '../patches/paseo-work-records.mjs';
import { withConversationFocus, withoutConversationFocus } from '../patches/paseo-conversation-focus.mjs';
import { withExternalLinks, withoutExternalLinks } from '../patches/paseo-external-links.mjs';
import { withRelayPassword, withoutRelayPassword } from '../patches/paseo-relay-password.mjs';
import { withCompactionBuffer, withoutCompactionBuffer } from '../patches/paseo-compaction-buffer.mjs';
import { withOfferLink, withoutOfferLink } from '../patches/paseo-offer-link.mjs';
import { withSettingsCorrections, withoutSettingsCorrections } from '../patches/paseo-settings-corrections.mjs';
import { withAgentEditorSafety, withoutAgentEditorSafety } from '../patches/paseo-agent-editor-safety.mjs';
import { withChatUsability, withoutChatUsability } from '../patches/paseo-chat-usability.mjs';
import { withMarkdownTable, withoutMarkdownTable } from '../patches/paseo-markdown-table.mjs';
import { withDaemonUpdate, withoutDaemonUpdate } from '../patches/paseo-daemon-update.mjs';

const PRECOMPRESSED = [['.br', brotliCompressSync, brotliDecompressSync], ['.gz', gzipSync, gunzipSync]];

export const COMPOSER_FILE = 'dist/server/web-ui/_expo/static/js/web/index-adef1fefbec28e631ffabe705d0c00c6.js';
export const DESKTOP_COMPOSER_FILE = '/opt/PaseoDog/resources/app-dist/_expo/static/js/web/index-9cd0ab0eaa7ecfaa05b27fe0c2c0cecc.js';
const REVIEWED_BLOBS = new Set(['bdc4b8ed97dbccc7e6215d7f2f7be2e420fce895', '35606b3c900c220239427937d2aa55f0860f1bb4']);
export const QUEUE_GUARD = 'const z=j.useSessionStore.getState();if("paseodog"===z.sessions[t]?.agents?.get(e)?.provider&&(0,j.selectAgentTurnPresentation)(z.sessions[t],e).isActive){(0,E.queueComposerMessage)({agentId:e,text:n,attachments:s,queue:{read:e=>j.useSessionStore.getState().sessions[t]?.queuedMessages?.get(e)??[],write:e=>j.useSessionStore.getState().setQueuedMessages(t,e)}});return}';
const worktreeSetupTip = ['e.shouldShowWorktreeSetupCallout=function(t){return!0===t?.ok&&!n(t.config??{})}',
    'e.shouldShowWorktreeSetupCallout=function(t){return!1}'];
const edits = [
    ['return{status:s?.status??null,contextWindowMaxTokens:', 'return{provider:s?.provider??null,status:s?.status??null,contextWindowMaxTokens:'],
    ['Yn=(0,Z.resolveActiveSendBehavior)(Lt.sendBehavior,Xn)',
        'Yn="paseodog"===Ot.provider&&"steer"===Lt.sendBehavior?"queue":(0,Z.resolveActiveSendBehavior)(Lt.sendBehavior,Xn)'],
    ['Nn.current=async(e,n,s,o)=>{if(!yt)throw new Error(xt("workspace.terminal.hostDisconnected"));await',
        'Nn.current=async(e,n,s,o)=>{if(!yt)throw new Error(xt("workspace.terminal.hostDisconnected"));' + QUEUE_GUARD + 'await'],
];

// 팁 숨김만 되돌려 기존 패치와 함께 검토된 원본 해시를 검사한다.
export function withoutWorktreeSetupTip(source) {
    return source.replace(worktreeSetupTip[1], worktreeSetupTip[0]);
}

// 기존 첨부파일·대기열 저장 및 배출 로직을 유지하면서 PaseoDog의 자동 턴 교체만 차단한다.
export function patchedComposerSource(source) {
    source = withoutDaemonUpdate(source);
    source = withoutMarkdownTable(source);
    source = withoutChatUsability(source);
    source = withoutAgentEditorSafety(source);
    source = withoutSettingsCorrections(source);
    source = withoutOfferLink(source);
    const withoutSetupTip = withoutWorktreeSetupTip(withoutImportCwd(withoutAgentsSettings(withoutSidebarStatusShapes(withoutWorkRecords(withoutExternalLinks(withoutRelayPassword(withoutConversationFocus(withoutCompactionBuffer(source)))))))));
    // 테마 체인은 뉴트럴 펄·소프트 린넨 -> White2 순서로 해제하고 아래에서 역순으로 적용한다.
    const base = withoutHideReasoning(withoutUsageOrder(withoutUsageDonut(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutSetupTip))))))))));
    let original = base;
    for (const [before, after] of [...edits].reverse()) original = original.replace(after, before);
    if (!REVIEWED_BLOBS.has(gitBlob(original)))
        throw new Error('Paseo composer source hash mismatch');
    let result = original;
    for (const [before, after] of edits) {
        if (result.split(before).length !== 2) throw new Error('Paseo composer anchor mismatch');
        result = result.replace(before, after);
    }
    if (base !== original && base !== result) throw new Error('Partial Paseo composer patch');
    // 기존 OCHE 자리에는 현재 세션·새 세션 기본값을 구분하는 아이콘 전용 Fast 토글을 붙인다.
    // diff 알약 요소는 그대로 두고 별도 트랙 바 모듈에 현재 세션 하위 작업 진행 알약을 붙인다.
    // PaseoDog 하단 사이드바 분석 아이콘은 쿼터 행 대신 좌측 하단 도구줄에 둔다.
    // PaseoDog Effort 목록에 호스트 자동 추론 항목을 넣고 모델 선택창·토큰 설정의 중복 스위치는 뺀다.
    // 도움말 메뉴의 문제 신고 묶음만 렌더 목록에서 뺀다.
    // 외부 커뮤니티·저장소 링크 버튼은 렌더하지 않는다.
    // 사이드바 쿼터 게이지 채움도 호스트 windowTone 단계 색을 쓴다.
    // 사이드바 쿼터 공급자 순서를 Claude -> Codex로 고정하고 주간 짧은 이름 wk를 7D로 맞춘다.
    // 사용량 옵션의 Sidebar style에서 Donuts를 고르면 사이드바 쿼터를 링·초기화 카운트다운으로 그린다.
    // 워크트리 스크립트 설정을 권하는 팁은 프로젝트 설정 여부와 무관하게 숨긴다.
    // "추론 숨기기"를 켜면 완료된 최종 답변만 표시한다(모델 추론·네이티브 기록·승인·오류 유지).
    const hiddenSetupTip = original.replace(...worktreeSetupTip);
    // AI 엔진 설정의 압축 여유 버퍼 선택지를 Mixdog 상한에 맞춘 10/20/25%로 바꾼다.
    const resultWithChat = withChatUsability(withAgentEditorSafety(withSettingsCorrections(withOfferLink(withCompactionBuffer(withConversationFocus(withRelayPassword(withExternalLinks(withWorkRecords(withSidebarStatusShapes(withAgentsSettings(withImportCwd(withHideReasoning(withUsageOrder(withUsageDonut(withUsageColors(withWhite2Theme(withCollaboration(withAutoEffort(withAgentProgress(withSidebarToolbar(withHelpMenu(hiddenSetupTip))))))))))))))))))))));
    return withDaemonUpdate(withMarkdownTable(resultWithChat));
}

// 고정된 웹 입력창 번들만 수정하고 다른 클라이언트·공급자 동작은 건드리지 않는다.
export function patchPaseoComposer(root, { check = false } = {}) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== '0.11.4') throw new Error('Paseo 0.11.4 required');
    const path = resolve(root, COMPOSER_FILE);
    const source = readFileSync(path, 'utf8');
    const result = patchedComposerSource(source);
    if (check && source !== result) throw new Error('Paseo composer patch is missing');
    if (!check && source !== result) writeFileSync(path, result);
    // 서버가 br/gz 사전 압축본을 우선 제공하므로 압축본도 같은 번들로 맞춘다.
    for (const [extension, compress, decompress] of PRECOMPRESSED) {
        if (decompress(readFileSync(path + extension)).equals(Buffer.from(result))) continue;
        if (check) throw new Error('Paseo composer precompressed bundle is stale');
        writeFileSync(path + extension, compress(result));
    }
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self)
    patchPaseoComposer(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), { check: process.argv.includes('--check') });
