// 로컬 패치: 설치된 PaseoDog 데스크톱 번들의 검토된 표시·메뉴 지점만 수정한다.
import { gitBlob } from '../scripts/patch-mixdog.mjs';
import { answerOnlyRows } from './answer-only.mjs';
import { HIDE_REASONING_RESOURCE_UPDATES } from './paseo-hide-reasoning.mjs';

const edits = [
    ['const Le=[{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}',
        'const Le=[{id:"agents",labelKey:"settings.hostSections.agents",icon:f.Bot},{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound}'],
    ['const y=n.hideReasoning?l(T):T;',
        `const A=n.hideReasoning?(${answerOnlyRows.toString()})(T,o,n.isTurnActive):{tail:T,head:o},y=A.tail;`],
    ['head:n.hideReasoning?l(o):o,preparedHistory:b', 'head:A.head,preparedHistory:b'],
    ...HIDE_REASONING_RESOURCE_UPDATES,
];

// 원본·기적용 출력 확인 (검토한 전체 blob에만 동일한 표시 변경 적용)
export function patchedDesktopSettings(source) {
    const original = edits.reduce((text, [before, after]) => text.replace(after, () => before), source);
    if (gitBlob(original) !== '4c53bd249bb6ac1cc3ebdf0a32a55bf9aaa7ed35')
        throw new Error('Desktop settings source hash mismatch');
    let result = original;
    for (const [before, after] of edits) {
        if (result.split(before).length !== 2) throw new Error('Desktop settings anchor mismatch');
        result = result.replace(before, () => after);
    }
    const previous = edits.slice(0, 3).reduce((text, [before, after]) => text.replace(before, () => after), original);
    if (source !== original && source !== result && source !== previous) throw new Error('Partial desktop settings patch');
    return result;
}
