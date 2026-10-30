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

export const GPU_SPEECH_MODEL = {
    id: 'whisper-turbo-cuda', label: 'Whisper Large-v3 Turbo · NVIDIA GPU',
    description: '한국어 지원 다국어 모델 · 호스트 NVIDIA GPU에서 로컬 처리',
    warning: 'CUDA GPU 전용이에요. GPU 메모리·전력 사용량이 늘고 다른 GPU 작업이 느려질 수 있어요. GPU 초기화 실패 시 CPU나 유료 API로 자동 전환하지 않아요.',
};

export const KOMIX_SPEECH_MODEL = {
    ...GPU_SPEECH_MODEL,
    id: 'whisper-medium-komix-v2-cuda', label: 'Whisper Medium KoMix-v2',
    description: '한국어 특화 · 호스트 NVIDIA GPU에서 로컬 처리 · 별도 모델 설치 필요',
};
