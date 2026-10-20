// Mixdog 네이티브 ask_user(kind:'question') <-> Paseo 공용 질문 UI 변환.
// 요청: Paseo parseQuestionFormQuestions 입력, 응답: buildQuestionFormAnswers({[header]: string}).
const MAX_QUESTIONS = 4;
const MAX_TEXT = 4000;

// 네이티브 질문 인자 검증 -> 헤더 중복 거부 -> Paseo 질문 입력 생성.
export function questionRequestInput(args) {
    const questions = args?.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_QUESTIONS) throw new Error('Malformed question request');
    const headers = new Set();
    return { questions: questions.map((question, index) => {
        if (!question || typeof question.question !== 'string' || typeof question.header !== 'string' || !question.header.trim()) throw new Error('Malformed question request');
        if (headers.has(question.header)) throw new Error('Duplicate question headers cannot be answered safely');
        headers.add(question.header);
        if (!Array.isArray(question.options) || question.options.length < 2) throw new Error('Malformed question request');
        const options = question.options.map((option) => {
            if (!option || typeof option.label !== 'string' || !option.label || typeof option.description !== 'string') throw new Error('Malformed question request');
            return { label: option.label, description: option.description };
        });
        const multiSelect = question.multi_select === true;
        return { id: String(index), header: question.header, question: question.question, options, multiSelect, allowOther: true };
    }) };
}

// ", "로 합친 다중 선택 문자열을 서로 다른 라벨 조합으로 분해 -> 해석이 정확히 하나일 때만 반환.
function splitLabels(value, labels) {
    const found = [];
    const walk = (rest, used) => {
        for (const label of labels) {
            if (found.length > 1) return;
            if (used.includes(label)) continue;
            if (rest === label) found.push([...used, label]);
            else if (rest.startsWith(`${label}, `)) walk(rest.slice(label.length + 2), [...used, label]);
        }
    };
    walk(value, []);
    return found.length === 1 ? found[0] : null;
}

// Paseo 응답 updatedInput.answers -> 질문 순서의 네이티브 answers({selected, text?}) 배열.
export function questionAnswers(questions, updatedInput) {
    const answers = updatedInput?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Question answers are missing');
    const headers = new Set(questions.map((question) => question.header));
    if (Object.keys(answers).some((key) => !headers.has(key))) throw new Error('Question answers contain an unknown question');
    return questions.map((question) => {
        const value = answers[question.header];
        if (typeof value !== 'string' || !value.trim()) throw new Error(`Answer ${question.header} before submitting`);
        if (value.length > MAX_TEXT) throw new Error(`Answer ${question.header} is too long`);
        const labels = question.options.map((option) => option.label);
        if (question.multi_select === true) {
            const selected = splitLabels(value, labels);
            // 공용 UI가 선택과 직접 입력을 한 문자열로 합치므로, 구분할 수 없는 답은 원문 전체를 보존한다.
            return selected ? { selected } : { selected: [], text: value.trim() };
        }
        // 단일 선택: 라벨과 정확히 같으면 선택, 아니면 사용자가 입력한 텍스트(UI가 trim한 값).
        if (labels.includes(value)) return { selected: [value] };
        return { selected: [], text: value.trim() };
    });
}
