import test from 'node:test';
import { runSharedAppTests } from './shared-app-tests.mjs';

// 압축 문자열 패치 대신 실제 레이아웃 계산과 Chromium의 너비·행 정렬·
// 긴 텍스트 보존·창 크기 및 글꼴 변경 후 재측정을 검사한다.
test('shared markdown tables preserve content sizing and browser row alignment', () =>
    runSharedAppTests([
        'src/components/markdown/table-layout.test.ts',
        'src/components/markdown/table.browser.test.tsx',
    ]));
