import test from 'node:test';
import { runSharedAppTests } from './shared-app-tests.mjs';

// 기존 공유 화면 회귀 검사를 재사용한다. 문자열 모양 대신 실제 렌더링·클릭,
// 단축키 가용성·앱/호스트 버전·문제 신고 항목 부재를 모두 검증한다.
test('shared help menu preserves actions, availability and versions without the report group', () =>
    runSharedAppTests(['src/components/sidebar/sidebar-help-menu.test.tsx']));
