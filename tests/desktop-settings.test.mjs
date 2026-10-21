import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { patchedDesktopSettings } from '../patches/paseo-desktop-settings.mjs';

// 이전 방식(설치본 덮어쓰기) 데스크톱 번들. 소스로 빌드한 .deb 설치본에는 없다.
const LEGACY_DESKTOP_BUNDLE = '/opt/PaseoDog/resources/app-dist/_expo/static/js/web/index-92699df43a283bb08831cc9d2fb07982.js';

// 설치 번들의 전체 해시·문법·재적용 검증 (실제 앱 실행과는 구분)
test('reviewed installed desktop settings patch is valid and rejects drift', { skip: !existsSync(LEGACY_DESKTOP_BUNDLE) }, () => {
    const source = readFileSync(LEGACY_DESKTOP_BUNDLE, 'utf8');
    const result = patchedDesktopSettings(source);
    new Script(result);
    assert.equal(patchedDesktopSettings(result), result);
    assert.throws(() => patchedDesktopSettings(source + '// drift'), /hash mismatch/);
});
