export interface InterruptConfirmationRequest {
  confirm: () => Promise<boolean>;
  isCurrent: () => boolean;
  interrupt: () => void;
  reportError: (error: unknown) => void;
}

// Esc 반복 입력은 하나로 묶고 승인 중에 대상 턴이 바뀌면 중단하지 않는다.
export function createInterruptConfirmation() {
  let pending = false;
  return async (request: InterruptConfirmationRequest): Promise<void> => {
    if (pending) return;
    pending = true;
    try {
      if ((await request.confirm()) && request.isCurrent()) request.interrupt();
    } catch (error) {
      request.reportError(error);
    } finally {
      pending = false;
    }
  };
}
