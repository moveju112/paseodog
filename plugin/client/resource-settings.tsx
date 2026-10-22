import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineResources } from '../shared/controls.js';

const actionLabels: Record<string, string> = {
    mcpAdd: 'MCP 추가', mcpSave: 'MCP 수정', mcpRemove: 'MCP 삭제', mcpEnable: 'MCP 활성화 변경',
    mcpReconnect: 'MCP 재연결', mcpLogin: 'MCP 로그인', mcpLoginComplete: 'MCP 인증 완료',
    mcpLoginCancel: 'MCP 로그인 취소', skillAdd: '스킬 추가', skillSave: '스킬 수정',
    skillsReload: '스킬 다시 불러오기', pluginAdd: '플러그인 설치', pluginUpdate: '플러그인 업데이트',
    pluginRemove: '플러그인 삭제', pluginEnable: '플러그인 활성화 변경', pluginsReload: '플러그인 다시 불러오기',
};

// MCP·스킬·플러그인 관리는 전용 프로필의 네이티브 API로 수행한다.
export function ResourceSettings({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(engineResources);
    const [snapshot, setSnapshot] = useState<any>(null);
    const [tab, setTab] = useState<'mcp' | 'skills' | 'plugins'>('mcp');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [body, setBody] = useState('');
    const [loadedSkill, setLoadedSkill] = useState('');
    const [command, setCommand] = useState('');
    const [argumentsText, setArgumentsText] = useState('');
    const [url, setUrl] = useState('');
    const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
    const [source, setSource] = useState('');
    const [flow, setFlow] = useState<any>(null);
    const [callbackUrl, setCallbackUrl] = useState('');
    const [preview, setPreview] = useState('');
    const [pending, setPending] = useState<Parameters<typeof invoke>[0] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const text = { color: theme.colors.foreground, fontSize: 15 };
    const inputStyle = { ...text, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 };

    // 변경 성공을 재생하지 않고 조회로 확인하며 OAuth는 명시적으로 상태를 확인한다.
    async function run(request: Parameters<typeof invoke>[0]) {
        setBusy(true); setError(''); setPending(null);
        try {
            const value: any = await invoke(request);
            if (request.operation === 'skillRead') {
                setPreview(value.content); setBody(value.content); setLoadedSkill(request.name || '');
            }
            else if (request.operation.startsWith('mcpLogin')) setFlow(value);
            else setSnapshot(value);
        } catch (failure) {
            setError((failure instanceof Error ? failure.message : '확장 관리 실패')
                + ' 변경은 자동 재시도하지 않습니다.');
        } finally { setBusy(false); }
    }
    useEffect(() => { void run({ operation: 'read' }); }, []);

    // 설치·수정·삭제는 실행 내용을 한 번 더 확인한 뒤에만 전달한다.
    function change(request: Parameters<typeof invoke>[0]) {
        setPending({ ...request, confirmed: true });
    }
    // 네이티브·web에서 동일한 접근성 버튼을 제공한다.
    function button(label: string, press: () => void, disabled = busy) {
        return <Pressable key={label} accessibilityRole="button" disabled={disabled}
            accessibilityState={{ disabled }} onPress={press}
            style={{ padding: 12, minHeight: 48, borderWidth: 1, borderColor: theme.colors.border,
                borderRadius: 8, opacity: disabled ? 0.5 : 1 }}><Text style={text}>{label}</Text></Pressable>;
    }

    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ ...text, fontSize: 22 }}>Mixdog 확장 관리</Text>
        <Text style={text}>이 호스트의 PaseoDog 전용 프로필만 변경합니다. MCP·플러그인은 프로그램을 실행할 수 있어요.</Text>
        {button('새로고침', () => void run({ operation: 'read' }))}
        {(['mcp', 'skills', 'plugins'] as const).map((value) => button(
            `${tab === value ? '선택됨 · ' : ''}${value}`, () => { setTab(value); setPending(null); setPreview(''); }))}
        {error ? <Text accessibilityLiveRegion="polite" style={{ ...text, color: theme.colors.statusDanger }}>{error}</Text> : null}
        {tab === 'mcp' && <>
            <Text style={text}>저장된 MCP는 자동 상속하지 않습니다. 설정을 저장한 뒤 세션 도구에서 서버를 직접 연결·재연결해야 해당 세션에 반영됩니다.</Text>
            {snapshot?.mcp?.map((row: any) => <View key={row.name} style={{ gap: 6 }}>
                <Text style={text}>{row.name} · {row.connected ? '연결됨' : '연결 안 됨'}</Text>
                {button(`${row.name} ${row.enabled === false ? '켜기' : '끄기'}`, () => change({ operation: 'mcpEnable', name: row.name, enabled: row.enabled === false }))}
                {button(`${row.name} 재연결`, () => change({ operation: 'mcpReconnect', name: row.name }))}
                {button(`${row.name} OAuth 로그인`, () => change({ operation: 'mcpLogin', name: row.name }))}
                {button(`${row.name} 삭제`, () => change({ operation: 'mcpRemove', name: row.name }))}
            </View>)}
            <TextInput accessibilityLabel="MCP 이름" placeholder="MCP 이름" value={name} onChangeText={setName} style={inputStyle} />
            {(['stdio', 'http', 'sse'] as const).map((type) => button(
                `${transport === type ? '선택됨 · ' : ''}${type}`, () => setTransport(type)))}
            <TextInput accessibilityLabel="MCP 명령" placeholder="stdio 실행 명령" value={command} onChangeText={setCommand} style={inputStyle} />
            <TextInput accessibilityLabel="MCP 인자" placeholder="인자 하나마다 줄바꿈" multiline value={argumentsText} onChangeText={setArgumentsText} style={inputStyle} />
            <TextInput accessibilityLabel="MCP URL" placeholder="HTTP/SSE URL" value={url} onChangeText={setUrl} style={inputStyle} />
            {(['mcpAdd', 'mcpSave'] as const).map((operation) => button(operation === 'mcpAdd' ? 'MCP 추가' : 'MCP 수정',
                () => change({ operation, data: { name, ...(transport !== 'stdio' ? { type: transport, url }
                    : { type: 'stdio', command, args: argumentsText ? argumentsText.split('\n') : [] }) } })))}
            {flow && <>
                <Text style={text}>로그인 상태: {flow.state}</Text>
                {flow.url && button('로그인 페이지 열기', () => { void Linking.openURL(flow.url); })}
                {flow.flowId && <>
                    {button('로그인 상태 확인', () => void run({ operation: 'mcpLoginStatus', flowId: flow.flowId }))}
                    <TextInput accessibilityLabel="OAuth 콜백 URL" placeholder="인증 후 리디렉션 URL" value={callbackUrl} onChangeText={setCallbackUrl} secureTextEntry style={inputStyle} />
                    {button('콜백 URL로 인증 완료', () => change({ operation: 'mcpLoginComplete', flowId: flow.flowId, callbackUrl }))}
                    {button('로그인 취소', () => change({ operation: 'mcpLoginCancel', flowId: flow.flowId }))}
                </>}
            </>}
        </>}
        {tab === 'skills' && <>
            {snapshot?.skills?.map((row: any) => button(`${row.name} 내용 보기`,
                () => { setName(row.name); setDescription(row.description || ''); setBody(''); setPreview(''); setLoadedSkill(''); void run({ operation: 'skillRead', name: row.name }); }))}
            {preview ? <Text selectable style={text}>{preview}</Text> : null}
            <TextInput accessibilityLabel="스킬 이름" placeholder="스킬 이름" value={name} onChangeText={setName} style={inputStyle} />
            <TextInput accessibilityLabel="스킬 설명" placeholder="설명" value={description} onChangeText={setDescription} style={inputStyle} />
            <TextInput accessibilityLabel="스킬 지침 본문" placeholder="저장할 지침 본문" multiline value={body} onChangeText={setBody} style={{ ...inputStyle, minHeight: 180 }} />
            {button('스킬 추가', () => change({ operation: 'skillAdd', data: { name, description, body } }))}
            {button('스킬 수정', () => change({ operation: 'skillSave', data: { name, originalName: name, description, body } }),
                busy || !loadedSkill || loadedSkill !== name)}
            {button('스킬 다시 불러오기', () => change({ operation: 'skillsReload' }))}
        </>}
        {tab === 'plugins' && <>
            {snapshot?.plugins?.map((row: any) => <View key={row.id} style={{ gap: 6 }}>
                <Text style={text}>{row.title || row.name} · {row.enabled === false ? '꺼짐' : '켜짐'}</Text>
                {button(`${row.title || row.name} 업데이트`, () => change({ operation: 'pluginUpdate', name: row.id }))}
                {button(`${row.title || row.name} ${row.enabled === false ? '켜기' : '끄기'}`,
                    () => change({ operation: 'pluginEnable', name: row.id, enabled: row.enabled === false }))}
                {button(`${row.title || row.name} 삭제`, () => change({ operation: 'pluginRemove', name: row.id }))}
            </View>)}
            <TextInput accessibilityLabel="플러그인 소스" placeholder="플러그인 소스" value={source} onChangeText={setSource} style={inputStyle} />
            {button('플러그인 설치', () => change({ operation: 'pluginAdd', data: { source } }))}
            {button('플러그인 다시 불러오기', () => change({ operation: 'pluginsReload' }))}
        </>}
        {pending && <View style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: theme.colors.statusWarning }}>
            <Text style={text}>{pending.name || pending.data?.name || pending.data?.source || '선택한 확장'}:
                {' '}{actionLabels[pending.operation]} 작업을 실행합니다. 실행 프로그램·설정·인증 상태가 바뀔 수 있어요.</Text>
            {button('확인하고 실행', () => void run(pending))}
            {button('취소', () => setPending(null))}
        </View>}
    </ScrollView>;
}
