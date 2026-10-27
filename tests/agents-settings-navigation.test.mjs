import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 모든 클라이언트가 빌드하는 실제 메뉴 배열의 경로와 번역 키를 검사한다.
test('shared clients expose the existing agents settings route exactly once', () => {
    const native = readFileSync(new URL('../android/packages/app/src/screens/settings-screen.tsx', import.meta.url), 'utf8');
    const nativeStart = native.indexOf('const HOST_SECTION_ITEMS: HostSectionItem[] = [') + 'const HOST_SECTION_ITEMS: HostSectionItem[] = '.length;
    const array = native.slice(nativeStart, native.indexOf('];', nativeStart) + 1);
    const icons = [...new Set([...array.matchAll(/icon: (\w+)/g)].map((match) => match[1]))];
    const shared = new Function(...icons, `return ${array}`)(...icons);
    for (const items of [shared]) {
        const entry = items.filter((item) => item.id === 'agents');
        assert.equal(entry.length, 1);
        assert.equal(entry[0].labelKey, 'settings.hostSections.agents');
        assert.equal(items.some((item) => item.id === 'engine-accounts'), true);
    }
    assert.equal(new Set(shared.map(item => item.id)).size, shared.length);
});
