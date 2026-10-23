import * as fs from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createAgentMessagePolicy } from '../../android/packages/server/src/server/agent/agent-message-policy.ts';

// 데몬과 같은 전용 홈을 사용한다. 설정 조회·저장 자체는 추론이나 재시작을 하지 않는다.
export function createMessagePolicyHandler(home = process.env.PASEO_HOME) {
    const policy = createAgentMessagePolicy({ fs, join, isAbsolute, home });
    return request => request.action === 'read' ? policy.read()
        : policy.write({ allowUnrelatedSessions: request.allowUnrelatedSessions });
}
