import { createAgentMcpIdentity } from '../android/packages/server/src/server/agent/agent-mcp-identity.ts';

const factory = `(${createAgentMcpIdentity.toString()})`;
export const MCP_CONFIG_IDENTITY_EDITS = [
    [
        'const PASEO_MCP_SERVER_NAME = "paseo";',
        'import * as agentMcpCrypto from "node:crypto";\nconst PASEO_MCP_SERVER_NAME = "paseo";',
    ],
    [
        'if (!params.mcpBaseUrl || storedConfig.mcpServers?.[PASEO_MCP_SERVER_NAME])',
        'if (!params.mcpBaseUrl || !params.mcpAuthToken || storedConfig.mcpServers?.[PASEO_MCP_SERVER_NAME])',
    ],
    [
        '                ...(params.mcpAuthToken\n                    ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }\n                    : {}),',
        '                headers: { Authorization: `Bearer ${'
            + `${factory}({ crypto: agentMcpCrypto, secret: params.mcpAuthToken }).mint(params.agentId)`
            + '}` },',
    ],
];

export const MCP_BOOTSTRAP_IDENTITY_EDITS = [
    [
        'import { createRequireBearerMiddleware, isAgentMcpRequestAuthorized, } from "./auth.js";',
        'import { createRequireBearerMiddleware, extractHttpBearerToken, isAgentMcpRequestAuthorized, } from "./auth.js";\nimport * as agentMcpCrypto from "node:crypto";',
    ],
    [
        '    const agentMcpAuthToken = randomUUID();',
        `    const agentMcpAuthToken = randomUUID();\n    const agentMcpIdentity = ${factory}({ crypto: agentMcpCrypto, secret: agentMcpAuthToken });`,
    ],
    [
        '            if (!(await isAgentMcpRequestAuthorized({\n                password: config.auth?.password,\n                capabilityToken: agentMcpAuthToken,\n                authorizationHeader: req.header("authorization"),\n            }))) {',
        '            const identity = await agentMcpIdentity.resolve({\n'
            + '                token: extractHttpBearerToken(req.header("authorization")),\n'
            + '                requestedCaller: req.query.callerAgentId,\n'
            + '                verifyPassword: async token => Boolean(config.auth?.password) && isAgentMcpRequestAuthorized({\n'
            + '                    password: config.auth?.password, capabilityToken: null, authorizationHeader: `Bearer ${token}`,\n'
            + '                }),\n            });\n            if (!identity.authorized) {',
    ],
    [
        '                const callerAgentIdRaw = req.query.callerAgentId;\n                let callerAgentId;\n                if (typeof callerAgentIdRaw === "string") {\n                    callerAgentId = callerAgentIdRaw;\n                }\n                else if (Array.isArray(callerAgentIdRaw) && typeof callerAgentIdRaw[0] === "string") {\n                    callerAgentId = callerAgentIdRaw[0];\n                }\n                const { server, transport } = await createAgentMcpSession(callerAgentId);',
        '                const { server, transport } = await createAgentMcpSession(identity.callerAgentId);',
    ],
];

export function withoutMcpIdentity(source, edits) {
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some(count => count > 1) || (counts.includes(0) && counts.includes(1)))
        throw new Error('Partial Paseo MCP identity patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, before);
    return source;
}

export function withMcpIdentity(source, edits) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error('Paseo MCP identity anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
