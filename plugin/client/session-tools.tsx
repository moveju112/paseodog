import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineControls, engineResources, engineSession, engineStatus } from '../shared/controls.js';

// 열린 세션을 명시적으로 선택하고 계승·복구·quota 재개를 확인 후 실행한다.
export function SessionTools({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(engineSession);
    type Request = Parameters<typeof invoke>[0];
    const readStatus = useRpc(engineStatus);
    const readControls = useRpc(engineControls);
    const readResources = useRpc(engineResources);
    const [sessions, setSessions] = useState<any[]>([]);
    const [models, setModels] = useState<any[]>([]);
    const [servers, setServers] = useState<any[]>([]);
    const [sessionId, setSessionId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [result, setResult] = useState<any>(null);
    const [turns, setTurns] = useState<any[]>([]);
    const [checkpointId, setCheckpointId] = useState('');
    const [pending, setPending] = useState<Request | null>(null);
    const [messageStart, setMessageStart] = useState(0);
    const colors = theme.colors;
    const text = { color: colors.foreground, fontSize: 15 };
    const session = sessions.find((row) => row.id === sessionId);
    const unavailable = busy || !session || !['idle', 'failed'].includes(session.state);
    const model = models.find((row) => row.id === session?.model && row.provider === session?.provider);

    // 조회는 재전송 없이 현재 호스트의 실제 연결 목록을 가져온다.
    async function refresh() {
        try {
            const [status, settings, resources] = await Promise.all([
                readStatus({}), readControls({ action: 'read' }), readResources({ operation: 'read' }),
            ]);
            setSessions((status as any).sessions);
            setModels((settings as any).models);
            setServers((resources as any).mcp);
        } catch (failure) { setError(failure instanceof Error ? failure.message : '조회 실패'); }
    }
    useEffect(() => { void refresh(); }, []);

    // 실행 결과만 표시하며 오류가 나면 같은 변경을 자동으로 다시 보내지 않는다.
    async function run(request: Request) {
        setBusy(true); setError(''); setNotice(''); setPending(null);
        try {
            const value: any = await invoke(request);
            if (request.operation === 'history') setTurns(value.turns);
            else if (request.operation === 'quotaRetry') {
                setNotice(value.state === 'completed' ? '현재 상태에서 이어서 처리했어요.' : `재개 결과: ${value.state}`);
            }
            else if (request.operation === 'mcpConnect')
                setNotice(value.connected ? '선택한 MCP를 이 세션에 연결했어요.' : 'MCP가 연결되지 않았어요. 확장 관리에서 인증 상태를 확인하세요.');
            else if (request.operation === 'fork')
                setNotice('대화를 계승했어요. 새 채팅의 기존 세션 가져오기 목록에서 선택하세요. 원본은 유지됩니다.');
            else if (['undo', 'redo'].includes(request.operation)) {
                setNotice(value.ok === false || value.conflict ? '복구 결과를 확인해 주세요.' : '복구 요청을 처리했어요.');
                setResult(await invoke({ sessionId, operation: 'changes', checkpointId }));
            } else setResult(value);
            await refresh();
        } catch (failure) {
            setError((failure instanceof Error ? failure.message : '작업 실패')
                + ' 결과가 불확실하면 상태를 확인하고 다시 선택하세요.');
        } finally { setBusy(false); }
    }

    // 작은 화면에서도 같은 의미와 충분한 터치 영역을 제공한다.
    function button(label: string, onPress: () => void, disabled = unavailable) {
        return <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled }}
            disabled={disabled} onPress={onPress} style={{ padding: 12, minHeight: 48,
                borderWidth: 1, borderColor: colors.border, borderRadius: 8, opacity: disabled ? 0.5 : 1 }}>
            <Text style={text}>{label}</Text>
        </Pressable>;
    }

    // 확인할 변경의 대상과 종류를 고정한 뒤 별도의 확인 버튼을 보여준다.
    function confirm(operation: Request['operation'], extra: Partial<Request> = {}) {
        setPending({ sessionId, operation, ...extra, confirmed: true });
    }

    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ ...text, fontSize: 22 }}>Mixdog 세션 도구</Text>
        <Text style={text}>열린 세션을 선택하세요. 변경은 이 세션에만 적용되고 Main 기본 모델은 유지됩니다.</Text>
        {button('세션 새로고침', () => void refresh(), busy)}
        {sessions.map((row) => button(`${row.id === sessionId ? '선택됨 · ' : ''}${row.title || '세션'} · ${row.model || '모델 확인 대기'}${row.createdAt ? ` · ${new Date(row.createdAt).toLocaleString()}` : ''}`,
            () => {
                setSessionId(row.id); setResult(null); setTurns([]); setCheckpointId('');
                setMessageStart(0); setPending(null); setNotice(''); setError('');
            }, busy))}
        {error ? <Text accessibilityLiveRegion="polite" style={{ ...text, color: colors.statusDanger }}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={text}>{notice}</Text> : null}
        {session && <>
            <Text style={text}>{session.provider} / {session.model} · {session.state}</Text>
            <Text style={text}>모델 전환</Text>
            {models.map((row) => button(`${row.label} · ${row.provider}`,
                () => void run({ sessionId, operation: 'configure', changes: { model: `${row.provider}/${row.id}` } })))}
            {model?.fastCapable && button(`Fast ${session.fast ? '끄기' : '켜기'}`,
                () => void run({ sessionId, operation: 'configure', changes: { route: { fast: !session.fast } } }))}
            {[100, 90, 70, 50].map((percent) => button(`이 세션 컨텍스트 한도 ${percent}%`,
                () => void run({ sessionId, operation: 'configure', changes: { route: { contextPercent: percent } } })))}
            {button('현재 대화를 새 세션으로 계승', () => confirm('fork'))}
            {servers.map((server) => button(`MCP ${server.name} 이 세션에 연결`,
                () => confirm('mcpConnect', { name: server.name })))}
            {button('턴별 변경 이력', () => void run({ sessionId, operation: 'history' }))}
            {turns.map((turn, index) => button(`최근 ${index + 1}번째 턴 · ${turn.files}개 파일`,
                () => { setCheckpointId(turn.checkpointId); void run({ sessionId, operation: 'changes', checkpointId: turn.checkpointId }); }))}
            {result?.files?.map((file: any) => <View key={file.path} style={{ gap: 8 }}>
                <Text selectable style={text}>{file.path} · {file.state || '변경됨'}</Text>
                {button(`패치 보기 · ${file.path}`, () => void run({ sessionId, operation: 'changes', checkpointId, file: file.path }))}
                {file.reason ? <Text style={text}>{file.reason}</Text> : null}
                {button(`Undo · ${file.path}`, () => confirm('undo', { checkpointId, file: file.path, revision: result.revision }),
                    unavailable || result.status !== 'ready' || file.revertable !== true || file.state === 'reverted')}
                {button(`Redo · ${file.path}`, () => confirm('redo', { checkpointId, file: file.path, revision: result.revision }),
                    unavailable || result.status !== 'ready' || file.revertable !== true || file.state !== 'reverted')}
            </View>)}
            {result?.patch ? <Text selectable style={{ ...text, fontFamily: 'monospace' }}>{result.patch}</Text> : null}
            {checkpointId && result?.files && <>
                {result.reason ? <Text style={text}>{result.reason}</Text> : null}
                {button('선택한 턴 전체 Undo', () => confirm('undo', { checkpointId, revision: result.revision }),
                    unavailable || result.canUndo !== true)}
                {button('선택한 턴 전체 Redo', () => confirm('redo', { checkpointId, revision: result.revision }),
                    unavailable || result.canReapply !== true)}
            </>}
            {button('실제 모델 컨텍스트 보기', () => void run({ sessionId, operation: 'context', messageStart }))}
            {result?.messages?.map((message: any, index: number) => <View key={index} style={{ gap: 6 }}>
                <Text style={{ ...text, fontWeight: '600' }}>{message.role}</Text>
                <Text selectable style={text}>{message.text}</Text>
                {!!message.nonTextParts?.length && <Text style={text}>비텍스트 파트: {message.nonTextParts.join(', ')} · 원본은 네이티브 컨텍스트에 유지됩니다.</Text>}
            </View>)}
            {result?.messages && <>
                <Text style={text}>메시지 {messageStart + 1}부터 · 전체 {result.messageCount}개 · 각 본문 최대 8,000자 미리보기</Text>
                {button('이전 메시지', () => {
                    const start = Math.max(0, messageStart - 12); setMessageStart(start);
                    void run({ sessionId, operation: 'context', messageStart: start });
                }, unavailable || messageStart === 0)}
                {button('다음 메시지', () => {
                    const start = messageStart + 12; setMessageStart(start);
                    void run({ sessionId, operation: 'context', messageStart: start });
                }, unavailable || messageStart + 12 >= result.messageCount)}
            </>}
            {session.quota && <>
                <Text style={text}>확인된 quota 실패가 있어요. 원래 명령을 재전송하지 않고 현재 상태에서 계속합니다.</Text>
                {button('현재 상태에서 계속', () => confirm('quotaRetry'))}
                {Number.isFinite(session.quota.resetAt) && button('한도 복구 시각에 재개 예약', () => confirm('quotaSchedule'))}
            </>}
            {session.quotaResume && <>
                <Text style={text}>예약: {new Date(session.quotaResume.resetAt).toLocaleString()} · {session.quotaResume.state}</Text>
                {button('재개 예약 취소', () => void run({ sessionId, operation: 'quotaCancel' }))}
            </>}
        </>}
        {pending && <View style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: colors.statusWarning }}>
            <Text style={text}>{pending.operation === 'fork' ? '원본을 보존하고 새 대화를 만듭니다.'
                : pending.operation.startsWith('quota') ? '확인된 실패 세션에서 계속합니다. 예약은 연결 종료 시 실행되지 않습니다.'
                : pending.operation === 'mcpConnect' ? '선택한 MCP 서버를 이 세션에 연결합니다. 저장된 명령이 실행되거나 원격 서버에 연결될 수 있어요.'
                : '선택한 턴·파일의 실제 내용을 변경합니다. 다른 작업의 변경과 충돌하면 복구를 거절합니다.'}</Text>
            {button('확인하고 실행', () => void run(pending), busy)}
            {button('취소', () => setPending(null), busy)}
        </View>}
    </ScrollView>;
}
