import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installedComposerFixture } from './composer-fixture.mjs';
import { withHostSwitch, withoutHostSwitch } from '../patches/paseo-host-switch.mjs';
import { patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';

test('web host picker switches root host and selection while the gear still opens settings', () => {
    const source = installedComposerFixture();
    const start = source.indexOf('function ne(e){const hostFilters=');
    const end = source.indexOf('function ', start + 9);
    assert.ok(start > 0);
    const cache = Array(14).fill(Symbol.for('react.memo_cache_sentinel'));
    let filters = ['old'];
    const routes = [], settings = [];
    const store = Object.assign(selector => selector({ hostFilters: filters }), {
        getState: () => ({ selectHost: id => { filters = [id]; } }),
    });
    const jsx = (type, props) => ({ type, props });
    const component = runInNewContext(source.slice(start, end) + ';ne;', {
        M: { useSidebarViewStore: store }, n: { c: () => cache },
        K: { useHosts: () => [{ serverId: 'old' }, { serverId: 'new' }] },
        h: { useRef: () => ({}), useState: () => [true, () => {}] },
        oe: { jsx }, re: 'trigger', c: { Server: 'icon' }, W: { HostPicker: 'picker' },
        q: { buildHostRootRoute: id => `/h/${id}` }, r: () => ({ router: { replace: route => routes.push(route) } }),
        d: Array(5).fill(0), ie: id => `host-${id}`,
    });
    const props = { theme: {}, label: 'Hosts', onAddHost() {}, onOpenHostSettings: id => settings.push(id) };
    const first = component(props);
    first.props.onSelect('new');
    assert.deepEqual(routes, ['/h/new']);
    assert.deepEqual(settings, []);
    assert.equal(component(props).props.value, 'new');
    component(props).props.onOpenHostSettings('new');
    assert.deepEqual(settings, ['new']);
    // 설정에서 돌아와 같은 컴포넌트를 다시 그려도 선택값을 이전 호스트로 되돌리지 않는다.
    assert.equal(component(props).props.value, 'new');
    assert.equal(withHostSwitch(withoutHostSwitch(source)), source);
    assert.throws(() => patchedComposerSource(source.replace('selectedHost=1===hostFilters.length', 'selectedHost=2===hostFilters.length')), /hash mismatch|anchor mismatch/);
});
