import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { nativeConfigView } from '../shared/controls.js';

type Source = 'claude' | 'codex';
type SkillRow = {
    name: string; folder: string; description: string; body: string; bodyTruncated: boolean; path: string;
    realPath?: string; scope: string; scopeLabel: string; aliases: string[]; issues: string[];
    enabled: boolean | null; state: string; readStatus?: string;
};
type HookRule = {
    event: string; matcher: string; type: string; command?: string; commandWindows?: string; url?: string;
    prompt?: string; server?: string; tool?: string; timeout?: number; async?: boolean; headerCount?: number;
    truncated?: boolean; source: string; scope: string; position: string; enabled: boolean | null; state: string;
};
type FileRow = { path: string; scope: string; label: string; status: string; error?: string; warnings?: string[]; count?: number };
type NativeView = {
    source: Source; label: string; notice: string; configRoot: string; observedAt: number;
    skills: { roots: FileRow[]; items: SkillRow[]; truncated: boolean };
    hooks: { supported: boolean; globalState: string; sources: FileRow[]; rules: HookRule[]; truncated: boolean };
    notes: string[];
};

const SOURCES: { id: Source; label: string }[] = [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }];
const FILE_STATUS: Record<string, string> = {
    ok: '읽음', missing: '없음', malformed: '형식 오류', 'too-large': '너무 큼', unreadable: '읽기 실패',
    'not-file': '파일 아님', 'not-directory': '폴더 아님',
};

// 원본 Claude/Codex 스킬·훅 읽기 전용 화면 (출처 선택 -> 조회 -> 목록 표시, 편집·실행 없음)
export function NativeConfigView({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(nativeConfigView);
    const [source, setSource] = useState<Source>('claude');
    const [views, setViews] = useState<Partial<Record<Source, NativeView>>>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [openSkill, setOpenSkill] = useState('');
    const generation = useRef(0);
    const colors = theme.colors;
    const text = { color: colors.foreground, fontSize: 15 };
    const muted = { ...text, color: colors.foregroundMuted, fontSize: 13 };
    const mono = { ...muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' };

    // 선택한 출처만 다시 읽기 (요청 -> 최신 응답만 반영, 실패 시 이전 표시 유지)
    async function load(target: Source) {
        const current = ++generation.current;
        setBusy(true);
        setMessage('');
        try {
            const next = await invoke({ source: target }) as NativeView;
            if (current !== generation.current) return;
            if (!Array.isArray(next?.skills?.items) || !Array.isArray(next?.hooks?.rules)) throw new Error('원본 설정 응답 형식 오류');
            setViews((previous) => ({ ...previous, [target]: next }));
            setMessage('원본 설정을 다시 읽었습니다.');
        } catch (error) {
            if (current === generation.current) setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (current === generation.current) setBusy(false);
        }
    }
    useEffect(() => { void load('claude'); }, []);

    // 출처 전환 (탭 선택 -> 처음 여는 출처만 조회)
    function select(target: Source) {
        setSource(target);
        setOpenSkill('');
        if (!views[target]) void load(target);
    }

    const view = views[source];
    const box = { gap: 4, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: colors.foregroundMuted };
    const stateText = (enabled: boolean | null) => (enabled === true ? '켜짐' : enabled === false ? '꺼짐' : '확인 불가');
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4 }}>
            {SOURCES.map((item) => {
                const selected = source === item.id;
                return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }}
                    accessibilityLabel={`${item.label} 원본 설정`} onPress={() => select(item.id)}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderBottomWidth: 2,
                        borderBottomColor: selected ? colors.accent : 'transparent' }}>
                    <Text style={{ ...text, fontWeight: selected ? '600' : '400' }}>{item.label}</Text>
                </Pressable>;
            })}
        </View>
        <View accessibilityRole="alert" style={box}>
            <Text style={{ ...text, fontWeight: '600' }}>원본 설정 보기 전용 · PaseoDog에 적용되지 않음</Text>
            <Text style={muted}>{view?.notice || 'Claude Code·Codex가 직접 읽는 원본 파일을 보여줄 뿐, PaseoDog 세션 설정이 아닙니다.'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="원본 설정 새로고침" disabled={busy}
            accessibilityState={{ disabled: busy }} onPress={() => void load(source)}
            style={{ padding: 12, minHeight: 48, borderWidth: 1, borderRadius: 8, borderColor: colors.foreground, opacity: busy ? 0.5 : 1 }}>
            <Text style={text}>{busy ? '읽는 중…' : '새로고침'}</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={text}>{message}</Text>
        {view && <>
            <Text style={muted}>설정 위치: {view.configRoot} · {new Date(view.observedAt).toLocaleString()}</Text>
            <Text accessibilityRole="header" style={{ ...text, fontSize: 18 }}>스킬 ({view.skills.items.length})</Text>
            {view.skills.roots.map((root) => <Text key={`root-${root.path}`} style={mono}>
                {root.label}: {root.path} · {FILE_STATUS[root.status] || root.status}{root.status === 'ok' ? ` · ${root.count ?? 0}개` : ''}</Text>)}
            {!view.skills.items.length && <Text style={text}>발견된 스킬이 없습니다.</Text>}
            {view.skills.items.map((skill) => {
                const key = `${skill.scope}:${skill.path}`;
                const expanded = openSkill === key;
                return <View key={key} style={box}>
                    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
                        accessibilityLabel={`스킬 ${skill.name} ${expanded ? '닫기' : '본문 보기'}`}
                        onPress={() => setOpenSkill(expanded ? '' : key)} style={{ minHeight: 44 }}>
                        <Text style={{ ...text, fontWeight: '600' }}>{skill.name} · {stateText(skill.enabled)}</Text>
                        <Text style={muted}>{skill.scopeLabel} · {skill.state}</Text>
                    </Pressable>
                    {!!skill.description && <Text style={text}>{skill.description}</Text>}
                    <Text selectable style={mono}>{skill.path}{skill.realPath ? ` → ${skill.realPath}` : ''}</Text>
                    {skill.aliases.map((alias) => <Text key={alias} selectable style={mono}>같은 스킬: {alias}</Text>)}
                    {skill.issues.map((issue) => <Text key={issue} style={muted}>⚠ {issue}</Text>)}
                    {expanded && <Text accessibilityLabel={`스킬 ${skill.name} 본문`} selectable style={mono}>
                        {skill.body}{skill.bodyTruncated ? '\n… (길이 제한으로 잘림)' : ''}</Text>}
                </View>;
            })}
            {view.skills.truncated && <Text style={muted}>스킬이 많아 일부만 표시했습니다.</Text>}

            <Text accessibilityRole="header" style={{ ...text, fontSize: 18 }}>훅 ({view.hooks.rules.length})</Text>
            <Text style={text}>{view.hooks.globalState}</Text>
            {view.hooks.sources.map((file) => <View key={`file-${file.path}`}>
                <Text style={mono}>{file.label}: {file.path} · {FILE_STATUS[file.status] || file.status}{file.error ? ` · ${file.error}` : ''}</Text>
                {(file.warnings || []).map((warning) => <Text key={warning} style={muted}>⚠ {warning}</Text>)}
            </View>)}
            {!view.hooks.rules.length && <Text style={text}>설정된 훅이 없습니다.</Text>}
            {view.hooks.rules.map((rule) => <View key={`${rule.source}:${rule.event}:${rule.position}`} style={box}>
                <Text style={{ ...text, fontWeight: '600' }}>{rule.event}{rule.matcher ? ` · ${rule.matcher}` : ''} · {stateText(rule.enabled)}</Text>
                <Text style={muted}>{rule.state} · {rule.type || '유형 없음'}{typeof rule.timeout === 'number' ? ` · ${rule.timeout}초` : ''}{rule.async ? ' · 비동기' : ''}</Text>
                {[rule.command, rule.commandWindows && `Windows: ${rule.commandWindows}`, rule.url, rule.prompt,
                    rule.server && `${rule.server} / ${rule.tool || ''}`].filter(Boolean).map((line) =>
                    <Text key={String(line)} selectable style={mono}>{line}</Text>)}
                {!!rule.headerCount && <Text style={muted}>헤더 {rule.headerCount}개 (값 숨김)</Text>}
                {rule.truncated && <Text style={muted}>길이 제한으로 일부 잘림</Text>}
                <Text style={muted}>{rule.source} · #{rule.position}</Text>
            </View>)}
            {view.hooks.truncated && <Text style={muted}>훅이 많아 일부만 표시했습니다.</Text>}
            <Text accessibilityRole="header" style={{ ...text, fontSize: 18 }}>참고</Text>
            {view.notes.map((note) => <Text key={note} style={muted}>• {note}</Text>)}
        </>}
    </ScrollView>;
}
