// 빈 값은 기존 닉네임 첫 글자 아바타를 유지한다.
export const ASSISTANT_ICONS = ["", "🐶", "🐱", "🤖", "✨", "🐾"] as const;
export type AssistantIcon = (typeof ASSISTANT_ICONS)[number];
