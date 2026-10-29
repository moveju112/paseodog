// 전체 원본 blob 검증은 호출하는 설치·composer 패치가 담당한다.
export const CLIENT_SESSION_RECOVERY_EDITS = [
    ['        this.connectionVerification = transport;\n',
        '        this.connectionVerification = transport;\n'
        + '        this.stopLivenessHeartbeat();\n'
        + '        this.rejectPingProbe(new Error("Connection verification started"));\n'
        + '        this.consecutiveLivenessFailures = 0;\n'],
    ['void this.ping({ timeoutMs: 3000 })',
        'void this.ping({ timeoutMs: LIVENESS_HEARTBEAT_TIMEOUT_MS })'],
    ['            if (this.connectionVerification === transport)\n                this.connectionVerification = null;',
        '            if (this.connectionVerification === transport) {\n'
        + '                this.connectionVerification = null;\n'
        + '                if (this.transport === transport) this.scheduleNextLivenessHeartbeat();\n'
        + '            }'],
    ['if (this.connectionState.status !== "connected" || this.livenessHeartbeatTimer) {',
        'if (this.connectionState.status !== "connected" || this.connectionVerification === this.transport || this.livenessHeartbeatTimer) {'],
];

const verifyBefore = 'verifyConnection(){const e=this.transport;e&&this.connectionVerification!==e&&(this.connectionVerification=e,this.ping({timeoutMs:3e3}).catch(s=>{this.transport===e&&"connected"===this.connectionState.status&&(this.disposeTransport(1001,"Connection verification failed"),this.scheduleReconnect({reason:s instanceof Error?s.message:String(s),event:"CONNECTION_VERIFICATION_FAILED",reasonCode:"liveness_timeout"}),this.ensureConnected())}).finally(()=>{this.connectionVerification===e&&(this.connectionVerification=null)}))}';
const verifyAfter = verifyBefore
    .replace('this.connectionVerification=e,this.ping({timeoutMs:3e3})',
        'this.connectionVerification=e,this.stopLivenessHeartbeat(),this.rejectPingProbe(new Error("Connection verification started")),this.consecutiveLivenessFailures=0,this.ping({timeoutMs:15e3})')
    .replace('this.connectionVerification=null)',
        'this.connectionVerification=null,this.transport===e&&this.scheduleNextLivenessHeartbeat())');
const heartbeatBefore = 'scheduleNextLivenessHeartbeat(){"connected"!==this.connectionState.status||this.livenessHeartbeatTimer||';
const heartbeatAfter = 'scheduleNextLivenessHeartbeat(){"connected"!==this.connectionState.status||this.connectionVerification===this.transport||this.livenessHeartbeatTimer||';
const webEdits = [[verifyBefore, verifyAfter], [heartbeatBefore, heartbeatAfter]];

export function withoutSessionRecovery(source) {
    const applied = webEdits.filter(([, after]) => source.includes(after)).length;
    if (applied !== 0 && applied !== webEdits.length)
        throw new Error('Partial Paseo session recovery patch');
    for (const [before, after] of [...webEdits].reverse()) source = source.replace(after, () => before);
    return source;
}

export function withSessionRecovery(source) {
    source = withoutSessionRecovery(source);
    for (const [before, after] of webEdits) {
        if (source.split(before).length !== 2) throw new Error('Paseo session recovery anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
