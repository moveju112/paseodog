const fields = {
    target: '대상',
    app: '앱',
    url: '페이지',
    field: '입력 항목',
    tab: '브라우저 탭',
    window_id: '창',
    ref: '입력 위치',
};
const needs = { sign_in: '로그인·인증', action: '직접 작업', confirmation: '본인·결제 확인' };

export function handoffPermission(input) {
    const handoff = input?.handoff;
    if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) ||
        Object.keys(input).some((key) => key !== 'handoff') ||
        !['secret', 'takeover'].includes(handoff.kind) || !['browser', 'computer'].includes(handoff.surface))
        throw new Error('Invalid handoff request');
    // 표시하지 못하는 인자는 숨겨서 승인받지 않고 거부한다.
    for (const [key, value] of Object.entries(handoff)) {
        if (!['kind', 'surface', 'instructions', 'need', 'purpose', ...Object.keys(fields)].includes(key) || typeof value !== 'string')
            throw new Error('Unsupported handoff field');
    }
    if ((handoff.need !== undefined && !Object.hasOwn(needs, handoff.need)) ||
        (handoff.purpose !== undefined && handoff.purpose !== 'login'))
        throw new Error('Unsupported handoff purpose');
    const context = Object.entries(fields).filter(([key]) => handoff[key] !== undefined)
        .map(([key, label]) => `${label}: ${handoff[key]}`);
    if (handoff.need) context.push(`작업: ${needs[handoff.need]}`);
    if (handoff.purpose) context.push('목적: 로그인');
    const surface = handoff.surface === 'browser' ? '브라우저' : '컴퓨터';
    const secret = handoff.kind === 'secret';
    return {
        title: secret ? '직접 입력이 필요해' : '직접 확인이 필요해',
        description: secret
            ? `${surface} 화면에 직접 입력하는 단계야. 비밀번호나 인증 코드는 채팅으로 보내지 마.`
            : `${surface}에서 직접 처리해야 하는 단계야. 아래 요청을 확인하고 허용해 줘.`,
        detail: { type: 'plain_text', text: [...context, handoff.instructions].filter(Boolean).join('\n\n') ||
            (secret ? '요청한 입력 항목을 해당 화면에 직접 입력해 줘.' : '요청한 화면에서 작업을 마친 뒤 알려 줘.') },
        actions: [
            { id: 'allow-once', label: '한 번 허용', behavior: 'allow', variant: 'primary' },
            { id: 'deny', label: '거절', behavior: 'deny', variant: 'danger' },
        ],
    };
}
