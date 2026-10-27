import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('shared screens omit community and repository buttons while retaining error recovery', () => {
    const root = fileURLToPath(new URL('../android/packages/app/src/', import.meta.url));
    const files = readdirSync(root, { recursive: true }).filter(path =>
        path.endsWith('.tsx') && !path.endsWith('.test.tsx'));
    assert.ok(files.length > 0);
    // 모든 실제 공유 화면을 확인한다. 옛 번들의 압축 식별자와 렌더 캐시는 더 이상 입력이 아니다.
    for (const path of files) {
        const source = readFileSync(join(root, path), 'utf8');
        assert.doesNotMatch(source, /CommunityLinks|Open GitHub issue|PaseoDog · GitHub/, path);
    }
    const errorScreen = readFileSync(join(root, 'screens/startup-splash-screen.tsx'), 'utf8');
    assert.match(errorScreen, /onPress=\{handleCopyLogs\}>\s*Copy logs/);
    assert.match(errorScreen, /onPress=\{bootstrapState\.retry\}>\s*Retry/);
    assert.doesNotMatch(errorScreen, />\s*Docs\s*</);
});
