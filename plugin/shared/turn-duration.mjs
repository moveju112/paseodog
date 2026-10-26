export const DEFAULT_TURN_MINUTES = 120;
// Node 타이머의 signed 32-bit 밀리초 한도를 넘지 않는다.
export const MAX_TURN_MINUTES = Math.floor(2147483647 / 60000);

export function validateTurnMinutes(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_TURN_MINUTES) {
        throw new Error(`명령 최대 실행 시간은 1~${MAX_TURN_MINUTES}분의 정수여야 해요.`);
    }
    return value;
}
