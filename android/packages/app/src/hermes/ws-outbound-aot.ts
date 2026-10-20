// Hermes(Android/iOS) 번들 전용: zod-aot 생성 검증기 대신 원본 Zod 스키마를 내보낸다.
// 생성 검증기는 함수 하나가 약 8.7만 줄이라 `hermesc -O`가 25분 넘게 끝나지 않는다.
// zod-aot 출력은 이 원본 스키마와 같은 결과를 내도록 protocol 테스트로 고정되어 있다.
export { WSOutboundMessageSchema } from "@getpaseo/protocol/messages";
