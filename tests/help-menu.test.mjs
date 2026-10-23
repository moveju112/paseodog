import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { HELP_MENU, HELP_MENU_ANCHOR, withoutHelpMenu, withHelpMenu } from '../patches/paseo-help-menu.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = composerFixture(installed);
import { composerFixture } from './composer-fixture.mjs';

test('help menu drops only the report-issue group and keeps help items and versions', () => {
    assert.equal(composerFixture(patched), patched);
    new Script(patched);
    assert.equal(patched.split(HELP_MENU).length, 2);
    assert.equal(patched.includes(HELP_MENU_ANCHOR), false);
    const children = HELP_MENU.match(/children:\[([^\]]+)\]/)[1].split(',');
    // 원본 목록: de 제목, ae 단축키, pe 새 소식, he 진단, ge 구분선, Ie 문제 신고 제목, me·Se 외부 링크, fe 구분선, ve 버전
    assert.deepEqual(children, ['de', 'ae', 'pe', 'he', 'fe', 've']);
    for (const [name, testId] of [['ae', 'sidebar-help-shortcuts'], ['pe', 'sidebar-help-changelog'],
        ['he', 'sidebar-help-diagnostics'], ['me', 'sidebar-help-discord'], ['Se', 'sidebar-help-github']]) {
        assert.ok(patched.includes(`(${name}=${name === 'ae' ? 'h?' : ''}(0,O.jsx)(b.DropdownMenuItem,{testID:"${testId}"`));
    }
    assert.ok(patched.includes('(Ie=(0,O.jsx)(b.DropdownMenuLabel,{children:be})'));
    assert.ok(patched.includes('ve=(0,O.jsxs)(t.View,{style:X.versionList,children:[we,ye]})'));
    // 공용 사이드바 하단이 폼 팩터 조건 없이 도움말 메뉴를 그리므로 PC·compact·모바일 웹이 같은 축소 목록을 쓴다.
    assert.ok(patched.includes('v=(0,oe.jsx)(P.SidebarHelpMenu,{})'));
    assert.ok(patched.includes('(_e=(0,O.jsxs)(b.DropdownMenuContent,{side:"top",align:"end",offset:8,width:280,' + HELP_MENU));
    assert.equal(withoutHelpMenu(withoutHelpMenu(patched)).includes(HELP_MENU), false);
    assert.throws(() => withHelpMenu(patched), /help menu anchor mismatch/);
});
