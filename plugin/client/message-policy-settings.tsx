import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { agentMessagePolicy } from '../shared/message-policy.js';

// 같은 플러그인 화면이 Android·데스크톱·웹에서 렌더된다.
export function MessagePolicySettings({ theme }: Pick<PluginSurfaceProps, 'theme'>) {
    const invoke = useRpc(agentMessagePolicy);
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const locked = useRef(false);
    const mounted = useRef(true);
    const text = { color: theme.colors.foreground, fontSize: 15 };

    async function request(allowUnrelatedSessions?: boolean) {
        if (locked.current) return;
        locked.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await invoke(allowUnrelatedSessions === undefined
                ? { action: 'read' } : { action: 'write', allowUnrelatedSessions });
            if (typeof result?.allowUnrelatedSessions !== 'boolean') throw new Error('설정 응답을 확인할 수 없습니다.');
            if (mounted.current) setAllowed(result.allowUnrelatedSessions);
        } catch {
            if (mounted.current) {
                setAllowed(null);
                setError('설정 결과를 확인할 수 없어요. 새로고침으로 확인하세요. 변경은 자동 재시도하지 않아요.');
            }
        } finally {
            locked.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    useEffect(() => {
        mounted.current = true;
        void request();
        return () => { mounted.current = false; };
    }, []);

    const disabled = busy || allowed === null;
    return <View style={{ gap: 8 }}>
        <Text style={{ ...text, fontSize: 18 }}>세션 간 메시지</Text>
        <Text style={text}>이 호스트에서 무관한 세션끼리 메시지를 주고받도록 허용해요. 꺼도 직접 부모·자식 에이전트 통신과 자동 오케스트레이터는 유지돼요.</Text>
        <Pressable accessibilityRole="switch" accessibilityLabel="무관한 세션 간 메시지 허용"
            accessibilityState={{ checked: allowed === true, disabled }} disabled={disabled}
            onPress={() => { if (allowed !== null) void request(!allowed); }}
            style={{ padding: 12, minHeight: 48, opacity: disabled ? 0.5 : 1 }}>
            <Text style={text}>{allowed === null ? '허용 상태 미확인' : allowed ? '무관한 세션 메시지 켜짐' : '무관한 세션 메시지 꺼짐'}</Text>
        </Pressable>
        <Text style={text}>다음 메시지부터 적용돼요. 이미 전달된 메시지와 진행 중인 작업은 취소하지 않아요.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="세션 메시지 설정 새로고침"
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void request()}
            style={{ padding: 12, minHeight: 48 }}>
            <Text style={text}>세션 메시지 설정 새로고침</Text>
        </Pressable>
        {error ? <Text accessibilityLiveRegion="polite" style={text}>{error}</Text> : null}
    </View>;
}
