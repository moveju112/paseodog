import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { patchedDesktopSettings } from '../patches/paseo-desktop-settings.mjs';

// 설치 번들의 전체 해시·문법·재적용 검증 (실제 앱 실행과는 구분)
test('reviewed installed desktop settings patch is valid and rejects drift', () => {
    const source = readFileSync('/opt/PaseoDog/resources/app-dist/_expo/static/js/web/index-92699df43a283bb08831cc9d2fb07982.js', 'utf8');
    const result = patchedDesktopSettings(source);
    new Script(result);
    assert.equal(patchedDesktopSettings(result), result);
    assert.throws(() => patchedDesktopSettings(source + '// drift'), /hash mismatch/);
});
