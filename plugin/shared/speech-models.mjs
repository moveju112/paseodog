// 한국어 지원 로컬 모델만 설정에 노출한다. .en 모델과 Parakeet은 제외한다.
export const KOREAN_SPEECH_MODELS = [
    {
        id: 'sense-voice-zh-en-ja-ko-yue-int8', label: 'SenseVoice Small',
        description: '한국어·영어 자동 감지 · 현재 기본값 · CPU',
        warning: '',
    },
    {
        id: 'whisper-base-int8', label: 'Whisper Base',
        description: '한국어 지원 다국어 모델 · 가벼운 비교 후보 · CPU',
        warning: '',
    },
    {
        id: 'whisper-small-int8', label: 'Whisper Small',
        description: '한국어 지원 다국어 모델 · Base보다 큰 모델 · CPU',
        warning: 'CPU 연산량이 늘어나 인식 결과가 늦게 나올 수 있어요. 실제 정확도는 같은 녹음으로 비교해 주세요.',
    },
    {
        id: 'whisper-turbo-int8', label: 'Whisper Large-v3 Turbo',
        description: '한국어 지원 다국어 모델 · GPU 가속 권장',
        warning: 'GPU는 필수가 아니지만 빠른 응답에는 권장돼요. 현재 통합은 CPU 실행이며 GPU를 자동 사용하지 않아요. CPU·메모리 사용량과 대기 시간이 커질 수 있어요.',
    },
];

export const DEFAULT_KOREAN_SPEECH_MODEL = KOREAN_SPEECH_MODELS[0].id;
