// 전용 프로필의 확장 관리 API만 노출하고 인증정보·내부 경로는 목록에서 제외한다.
export async function resourceControls(runtime, request) {
    const { operation, name, data = {}, enabled, flowId, callbackUrl } = request;
    if (!['read', 'skillRead', 'mcpLoginStatus'].includes(operation) && request.confirmed !== true)
        throw new Error('확장 설정 변경 확인이 필요해요.');
    let result;
    switch (operation) {
        case 'read': break;
        case 'mcpAdd': result = await runtime.addMcpServer(data); break;
        case 'mcpSave': result = await runtime.saveMcpServer(data); break;
        case 'mcpRemove': result = await runtime.removeMcpServer(name); break;
        case 'mcpEnable': result = await runtime.setMcpServerEnabled(name, enabled); break;
        case 'mcpReconnect': result = await runtime.reconnectMcp(name); break;
        case 'mcpLogin': return runtime.beginMcpOAuthLogin(name, { openBrowser: false });
        case 'mcpLoginStatus': return runtime.getMcpOAuthLoginStatus(flowId);
        case 'mcpLoginCancel': return runtime.cancelMcpOAuthLogin(flowId);
        case 'mcpLoginComplete': return runtime.completeMcpOAuthLogin(flowId, callbackUrl);
        case 'skillRead': {
            const skill = await runtime.skillContent(name);
            return { name: skill.name, content: skill.content };
        }
        case 'skillAdd': result = await runtime.addSkill(data); break;
        case 'skillSave': result = await runtime.saveSkill(data); break;
        case 'skillsReload': result = await runtime.reloadSkills(); break;
        case 'pluginAdd': result = await runtime.addPlugin(data.source); break;
        case 'pluginUpdate': result = await runtime.updatePlugin(name); break;
        case 'pluginRemove': result = await runtime.removePlugin(name); break;
        case 'pluginEnable': result = await runtime.setPluginEnabled(name, enabled); break;
        case 'pluginsReload': result = await runtime.reloadPlugins(); break;
        default: throw new Error('Unsupported resource operation');
    }
    const { flushPendingSessionConfigWrites } = await import('mixdog/src/session-runtime/config-lifecycle/config-writers.mjs');
    await flushPendingSessionConfigWrites();
    const mcp = await runtime.mcpStatus();
    const skills = await runtime.skillsStatus();
    const plugins = await runtime.pluginsStatus();
    return {
        changed: operation !== 'read', result: result ? { ok: true } : null,
        mcp: (mcp.servers || []).map((row) => ({
            name: row.name, enabled: row.enabled, connected: row.connected,
            authRequired: row.authRequired === true,
        })),
        skills: (skills.skills || []).map((row) => ({
            name: row.name, description: row.description, disabled: row.disabled,
        })),
        plugins: (plugins.plugins || []).map((row) => ({
            id: row.id, name: row.name, title: row.title, enabled: row.enabled,
        })),
    };
}
