import * as fs from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createAgentMessagePolicy } from '../../android/packages/server/src/server/agent/agent-message-policy.ts';

// 플러그인 번들 밖의 공용 서버 정책은 기존 제어 프로세스에서만 실행한다.
export function createMessagePolicyHandler(home = process.env.PASEO_HOME) {
    const policy = createAgentMessagePolicy({ fs, join, isAbsolute, home });
    return request => {
        if (request.action === 'read') return policy.read();
        if (request.action === 'write') return policy.write({ allowUnrelatedSessions: request.allowUnrelatedSessions });
        throw new Error('Unsupported message policy action');
    };
}
