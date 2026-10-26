import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineMetrics } from '../shared/controls.js';
import { createLiveMonitor } from './live-monitor.mjs';

// 화면을 보는 동안 2분마다 다시 조회한다(OAuth 실시간 갱신 여부는 호스트 정책이 정함).
const autoRefreshMs = 120000;

type Metric = { turns?: number; tokens?: number; input?: number; output?: number; cacheRead?: number;
    cacheWrite?: number; cacheHitRate?: number | null; costUsd?: number; costBilled?: number;
    costEstimated?: number; costUnpricedTurns?: number; outputTokensPerSecond?: number | null; share?: number | null };
type Metrics = {
    efforts?: (Metric & { provider: string; model: string; agent: string | null; effort: string | null; fast?: boolean | null })[];
    range: { fromMs: number; toMs: number }; totals: Metric; quotaError?: string;
    providers: (Metric & { provider: string; providerKind: string; models: (Metric & { model: string })[] })[];
    series: (Metric & { label: string | number })[];
    quotas: { id: string; label: string; authenticated: boolean; updatedAt: number | null;
        windows: { label: string; usedPct: number | null; resetAt: number | null }[];
        resetCredits: { availableCount: number } | null }[];
};
const periods = [['1h', '지난 1시간'], ['8h', '지난 8시간'], ['hour', '지난 24시간'], ['day', '지난 30일'],
    ['all', '전체'], ['custom', '사용자 지정']] as const;
const number = (value?: number | null) => value == null ? '—' : value.toLocaleString();
const speed = (value?: number | null) => value == null ? '—' : value.toFixed(1);
const fastLabel = (value?: boolean | null) => value === true ? '켜짐' : value === false ? '꺼짐' : '미기록';
const percent = (value?: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
// 달러 금액 표시 (값 -> $0.00, 없으면 대시)
const money = (value?: number | null) => value == null ? '—' : `$${value.toFixed(2)}`;
// 차트 축용 축약 숫자 (1234567 -> 1.2M)
const compact = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M`
    : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : `${Math.round(value)}`;
type Colors = PluginSurfaceProps['theme']['colors'];
type EffortRow = NonNullable<Metrics['efforts']>[number];
type EffortGroup = { agent: string | null; models: { provider: string; model: string; rows: EffortRow[] }[] };

// Effort 행 묶기 (에이전트 -> 제공자·모델 -> effort 행, 첫 등장 순서 유지·null과 문자열 구분)
function groupEfforts(efforts: EffortRow[]) {
    const groups = new Map<string, EffortGroup>();
    for (const row of efforts) {
        const agentKey = JSON.stringify(row.agent);
        let group = groups.get(agentKey);
        if (!group) groups.set(agentKey, group = { agent: row.agent, models: [] });
        let model = group.models.find((item) => item.provider === row.provider && item.model === row.model);
        if (!model) group.models.push(model = { provider: row.provider, model: row.model, rows: [] });
        model.rows.push(row);
    }
    return [...groups.values()];
}
type Column = { label: string; width: number; align?: 'left' | 'right'; grow?: boolean };
const providerColumns: Column[] = [{ label: '모델', width: 180, align: 'left', grow: true }, { label: '호출', width: 64 },
    { label: 'TOK/S', width: 64 }, { label: '토큰', width: 100 }, { label: '입력', width: 96 }, { label: '출력', width: 92 },
    { label: '캐시', width: 100 }, { label: '적중', width: 64 }, { label: '환산액', width: 80 }];
const effortColumns: Column[] = [{ label: '모델', width: 200, align: 'left', grow: true },
    { label: 'Effort', width: 96, align: 'left' }, { label: 'Fast', width: 72, align: 'left' },
    { label: 'TOK/S', width: 72 }, { label: '호출', width: 64 }, { label: '토큰', width: 110 },
    { label: '환산액', width: 80 }];

// 공통 카드 컨테이너 (테마 표면·테두리 적용)
function Card({ colors, children, style }: { colors: Colors; children: React.ReactNode; style?: object }) {
    return <View style={{ backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
        borderRadius: 12, padding: 14, gap: 10, ...style }}>{children}</View>;
}

// 요약 지표 타일 (라벨 -> 큰 값 -> 보조 설명)
function StatTile({ colors, label, value, hint }: { colors: Colors; label: string; value: string; hint?: string }) {
    return <Card colors={colors} style={{ flexGrow: 1, flexBasis: 150, minWidth: 140, gap: 4 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
        <Text selectable style={{ color: colors.foreground, fontSize: 22, fontWeight: '600' }}>{value}</Text>
        {!!hint && <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{hint}</Text>}
    </Card>;
}

// 0~100 비율 트랙 (배경 트랙 -> 채움 막대)
function Track({ colors, pct, color }: { colors: Colors; pct: number; color: string }) {
    return <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' }}>
        <View style={{ height: 6, borderRadius: 3, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }} />
    </View>;
}

// 컬럼 정렬 표 (머리글 한 번 -> 값 행, 좁은 화면은 가로 스크롤)
function Table({ colors, columns, rows, label }: { colors: Colors; columns: Column[];
    rows: { key: string; label: string; cells: string[] }[]; label: string }) {
    const minWidth = columns.reduce((sum, column) => sum + column.width, 0);
    // 이름 컬럼은 남는 폭을 채우고 숫자 컬럼은 고정 폭·우측 정렬
    const cellStyle = (column: Column) => ({ width: column.grow ? undefined : column.width, flexGrow: column.grow ? 1 : 0,
        flexBasis: column.grow ? column.width : undefined, flexShrink: 0, paddingHorizontal: 6, textAlign: column.align ?? 'right' });
    return <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
        <View accessibilityLabel={label} style={{ flexGrow: 1, minWidth }}>
            <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                {columns.map((column) => <Text key={column.label} numberOfLines={1}
                    style={{ ...cellStyle(column), color: colors.foregroundMuted, fontSize: 11, fontWeight: '600' }}>{column.label}</Text>)}
            </View>
            {rows.map((row, index) => <View key={row.key} accessibilityLabel={row.label} style={{ flexDirection: 'row', paddingVertical: 7,
                borderTopWidth: index ? 1 : 0, borderTopColor: colors.surface2 }}>
                {row.cells.map((value, cell) => <Text key={columns[cell].label} selectable numberOfLines={1}
                    style={{ ...cellStyle(columns[cell]), color: colors.foreground, fontSize: 12,
                        fontWeight: cell ? '400' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>)}
            </View>)}
        </View>
    </ScrollView>;
}

// 섹션 제목 (제목 -> 보조 설명)
function SectionTitle({ colors, title, hint }: { colors: Colors; title: string; hint?: string }) {
    return <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        {!!hint && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{hint}</Text>}
    </View>;
}

// 기간별 토큰 원장과 OAuth 할당량을 기존 Mixdog API로 조회한다.
export function UsageMonitor({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(engineMetrics);
    const latest = useRef(invoke);
    latest.current = invoke;
    const [view, setView] = useState<typeof periods[number][0]>('hour');
    const [details, setDetails] = useState(false);
    const [startDay, setStartDay] = useState('');
    const [endDay, setEndDay] = useState('');
    const [revision, setRevision] = useState(0);
    const [data, setData] = useState<Metrics | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const forceNext = useRef(false);
    useEffect(() => {
        setData(null);
        setError('');
        setBusy(false);
        if (view === 'custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(endDay))) return;
        setBusy(true);
        // 새로고침을 누른 직후 첫 조회만 강제하고 이후에는 자동 주기로 이어간다.
        const monitor = createLiveMonitor({
            delayMs: autoRefreshMs,
            read: () => {
                const refresh = forceNext.current ? 'force' : 'auto';
                forceNext.current = false;
                return latest.current({ view, ...(view === 'custom' ? { startDay, endDay } : {}), refresh });
            },
            onValue: (value: unknown) => { setData(value as Metrics); setError(''); setBusy(false); },
            onError: () => { setError('사용량 조회 실패. 연결 상태와 날짜 범위를 확인해 주세요. 자동으로 다시 확인해요.'); setBusy(false); },
        });
        monitor.setActive(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
        const subscription = AppState.addEventListener('change', (state) => monitor.setActive(state === 'active'));
        return () => { monitor.stop(); subscription.remove(); };
    }, [view, startDay, endDay, revision]);
    const colors = theme.colors;
    const text = { color: colors.foreground, fontSize: 14 };
    const muted = { color: colors.foregroundMuted, fontSize: 12 };
    const series = data?.series || [];
    const maxTokens = Math.max(0, ...series.map((row) => row.tokens || 0));
    const peak = Math.max(1, maxTokens);
    const chartHeight = 140;
    // 축 라벨 겹침 방지: 최대 8개 구간으로 묶어 각 구간 첫 라벨만 표시
    const labelStep = Math.max(1, Math.ceil(series.length / 8));
    const labelGroups: { label: string; size: number }[] = [];
    for (let index = 0; index < series.length; index += labelStep) {
        labelGroups.push({ label: String(series[index].label), size: Math.min(labelStep, series.length - index) });
    }
    const totals = data?.totals;
    const breakdown = totals ? [
        { label: '입력', value: totals.input || 0, color: colors.accent },
        { label: '출력', value: totals.output || 0, color: colors.statusSuccess },
        { label: '캐시 읽기', value: totals.cacheRead || 0, color: colors.statusWarning },
        { label: '캐시 쓰기', value: totals.cacheWrite || 0, color: colors.foregroundMuted },
    ] : [];
    const breakdownSum = breakdown.reduce((sum, item) => sum + item.value, 0);
    const inputStyle = { ...text, minWidth: 150, flexGrow: 1, flexBasis: 150, paddingHorizontal: 12, paddingVertical: 8,
        borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0 };
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View accessibilityRole="tablist" accessibilityLabel="사용량 보기"
            style={{ flexDirection: 'row', padding: 3, borderRadius: 9, backgroundColor: colors.surface2 }}>
            {([false, true] as const).map((value) => <Pressable key={String(value)} accessibilityRole="tab"
                accessibilityLabel={value ? '사용량 자세히' : '사용량 요약'}
                accessibilityState={{ selected: details === value }} onPress={() => setDetails(value)}
                style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7,
                    backgroundColor: details === value ? colors.surface0 : 'transparent' }}>
                <Text style={{ ...text, fontWeight: details === value ? '600' : '400',
                    color: details === value ? colors.foreground : colors.foregroundMuted }}>{value ? '자세히' : '요약'}</Text>
            </Pressable>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 3, borderRadius: 9,
                backgroundColor: colors.surface2, flexShrink: 1 }}>
                {periods.map(([id, label]) => {
                    const selected = view === id;
                    return <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected }}
                        onPress={() => setView(id)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
                            backgroundColor: selected ? colors.surface0 : 'transparent' }}>
                        <Text style={{ fontSize: 13, fontWeight: selected ? '600' : '400',
                            color: selected ? colors.foreground : colors.foregroundMuted }}>{label}</Text></Pressable>;
                })}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="사용량 새로고침" disabled={busy}
                onPress={() => { forceNext.current = true; setRevision((value) => value + 1); }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
                    opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13 }}>{busy ? '조회 중…' : '↻ 새로고침'}</Text>
            </Pressable>
        </View>
        {view === 'custom' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <TextInput accessibilityLabel="사용량 시작일" placeholder="YYYY-MM-DD" placeholderTextColor={colors.foregroundMuted}
                value={startDay} onChangeText={setStartDay} style={inputStyle} />
            <Text style={muted}>~</Text>
            <TextInput accessibilityLabel="사용량 종료일" placeholder="YYYY-MM-DD" placeholderTextColor={colors.foregroundMuted}
                value={endDay} onChangeText={setEndDay} style={inputStyle} />
        </View>}
        {view === 'custom' && !busy && !data && !error && <Text style={muted}>시작일과 종료일을 YYYY-MM-DD 형식으로 입력하면 조회해요.</Text>}
        {busy && !data && <Text style={muted}>조회 중…</Text>}
        {!!error && <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.statusDanger, backgroundColor: colors.surface1 }}>
            <Text accessibilityLiveRegion="polite" style={{ ...text, color: colors.statusDanger }}>{error}</Text></View>}
        {data && totals && <>
            <Text style={muted}>{new Date(data.range.fromMs).toLocaleString()} ~ {new Date(data.range.toMs).toLocaleString()} · 2분마다 자동 갱신</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <StatTile colors={colors} label="평균 응답 속도" value={`${speed(totals.outputTokensPerSecond)} tok/s`}
                    hint="측정된 출력 토큰 / 응답 시간 · 대기·추론 포함" />
                <StatTile colors={colors} label="토큰" value={number(totals.tokens)} />
                <StatTile colors={colors} label="호출" value={number(totals.turns)} />
                {details && <>
                    <StatTile colors={colors} label="환산액" value={money(totals.costUsd)} hint="구독 환산 · 청구액 아님" />
                    <StatTile colors={colors} label="API 비용" value={money(totals.costBilled)} />
                    <StatTile colors={colors} label="캐시 적중" value={percent(totals.cacheHitRate)} />
                </>}
            </View>
            {!!totals.costUnpricedTurns && <View style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.statusWarning }}>
                <Text style={{ ...text, fontSize: 13, color: colors.statusWarning }}>
                    가격 미확인 호출 {number(totals.costUnpricedTurns)}건은 비용 합계에서 누락될 수 있어요.</Text></View>}
            <SectionTitle colors={colors} title="OAuth 한도" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {data.quotas.map((row) => <Card key={row.id} colors={colors} style={{ flexGrow: 1, flexBasis: 280, minWidth: 240 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <Text selectable style={{ ...text, fontSize: 15, fontWeight: '600', flexShrink: 1 }}>{row.label}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3,
                            borderRadius: 999, backgroundColor: colors.surface2 }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4,
                                backgroundColor: row.authenticated ? colors.statusSuccess : colors.foregroundMuted }} />
                            <Text style={{ fontSize: 11, color: row.authenticated ? colors.statusSuccess : colors.foregroundMuted }}>
                                {row.authenticated ? '연결됨' : '미연결'}</Text>
                        </View>
                    </View>
                    {row.windows.map((window, index) => {
                        const used = window.usedPct || 0;
                        const tone = used >= 90 ? colors.statusDanger : used >= 70 ? colors.statusWarning : colors.accent;
                        return <View key={index} style={{ gap: 5 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                                <Text style={{ ...text, fontSize: 13 }}>{window.label}</Text>
                                <Text selectable style={{ ...text, fontSize: 13, fontWeight: '600', color: window.usedPct == null ? colors.foregroundMuted : tone }}>
                                    {window.usedPct == null ? '—' : `${window.usedPct}%`}</Text>
                            </View>
                            <Track colors={colors} pct={used} color={tone} />
                            {!!window.resetAt && <Text style={{ ...muted, fontSize: 11 }}>초기화 {new Date(window.resetAt).toLocaleString()}</Text>}
                        </View>;
                    })}
                    {!row.windows.length && <Text style={muted}>현재 사용량 결과 없음</Text>}
                    {details && !!(row.resetCredits || row.updatedAt) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
                        gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                        {row.resetCredits && <Text style={{ ...text, fontSize: 12 }}>리셋 티켓 {row.resetCredits.availableCount}개 남음</Text>}
                        {!!row.updatedAt && <Text style={{ ...muted, fontSize: 11 }}>마지막 갱신 {new Date(row.updatedAt).toLocaleString()}</Text>}
                    </View>}
                </Card>)}
                {!!data.quotaError && <Text accessibilityLiveRegion="polite" style={{ ...text, fontSize: 13, color: colors.statusWarning }}>
                    {data.quotaError}</Text>}
                {!data.quotas.length && !data.quotaError && <Text style={muted}>연결된 OAuth 계정 없음</Text>}
            </View>
            {details && <>
            <SectionTitle colors={colors} title="토큰" />
            <Card colors={colors}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <Text style={{ ...text, fontWeight: '600' }}>추이</Text>
                    <Text style={muted}>구간 최대 {number(maxTokens)} 토큰</Text>
                </View>
                {series.length ? <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ width: 44, height: chartHeight, justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <Text style={{ ...muted, fontSize: 10 }}>{compact(peak)}</Text>
                        <Text style={{ ...muted, fontSize: 10 }}>{compact(peak / 2)}</Text>
                        <Text style={{ ...muted, fontSize: 10 }}>0</Text>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                        <View style={{ height: chartHeight, justifyContent: 'flex-end' }}>
                            {[0, 0.5, 1].map((ratio) => <View key={ratio} style={{ position: 'absolute', left: 0, right: 0,
                                top: ratio * (chartHeight - 1), height: 1, backgroundColor: colors.border, opacity: ratio === 1 ? 1 : 0.5 }} />)}
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: chartHeight, gap: series.length > 60 ? 1 : 3 }}>
                                {series.map((row, index) => <View key={index} accessibilityLabel={`${row.label}: ${number(row.tokens)} 토큰`}
                                    style={{ flex: 1, height: Math.max(1, (row.tokens || 0) / peak * chartHeight),
                                        backgroundColor: colors.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3,
                                        opacity: row.tokens ? 1 : 0.35 }} />)}
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row' }}>
                            {labelGroups.map((group, index) => <Text key={index} numberOfLines={1}
                                style={{ ...muted, fontSize: 10, flex: group.size }}>{group.label}</Text>)}
                        </View>
                    </View>
                </View> : <Text style={muted}>해당 기간 기록 없음</Text>}
                <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ ...text, fontWeight: '600' }}>구성</Text>
                    <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface2 }}>
                        {breakdownSum > 0 && breakdown.map((item) => item.value > 0 &&
                            <View key={item.label} style={{ flex: item.value / breakdownSum, backgroundColor: item.color }} />)}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                        {breakdown.map((item) => <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
                            <Text style={muted}>{item.label}</Text>
                            <Text selectable style={{ ...text, fontSize: 13, fontWeight: '600' }}>{number(item.value)}</Text>
                        </View>)}
                    </View>
                </View>
            </Card>
            <SectionTitle colors={colors} title="제공자·모델" hint={`${data.providers.length}개 제공자`} />
            {!data.providers.length && <Text style={muted}>해당 기간 기록 없음</Text>}
            {data.providers.map((row) => <Card key={row.provider} colors={colors}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                        <Text selectable style={{ ...text, fontSize: 15, fontWeight: '600' }}>{row.provider}</Text>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ ...muted, fontSize: 11 }}>{row.providerKind}</Text></View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                        <Text style={muted}>점유 {percent(row.share)}</Text>
                        <Text selectable style={{ ...text, fontWeight: '700' }}>{money(row.costUsd)}</Text>
                    </View>
                </View>
                <Track colors={colors} pct={(row.share || 0) * 100} color={colors.accent} />
                <Table colors={colors} columns={providerColumns} label={`${row.provider} 모델별 사용량`}
                    rows={row.models.map((model) => ({ key: model.model, label: `${model.model} 사용량 지표`, cells: [model.model, number(model.turns),
                        number(model.outputTokensPerSecond), number(model.tokens), number(model.input), number(model.output),
                        number((model.cacheRead || 0) + (model.cacheWrite || 0)), percent(model.cacheHitRate), money(model.costUsd)] }))} />
            </Card>)}
            <SectionTitle colors={colors} title="에이전트·Effort·Fast" hint="모델·요청 effort·Fast 설정별 속도 비교" />
            {groupEfforts(data.efforts || []).map((group) => {
                const agentLabel = group.agent || '에이전트 미기록';
                return <Card key={JSON.stringify(group.agent)} colors={colors}>
                    <Text selectable style={{ ...text, fontSize: 15, fontWeight: '600' }}>{agentLabel}</Text>
                    <Table colors={colors} columns={effortColumns} label={`${agentLabel} 에이전트 사용량`}
                        rows={group.models.flatMap((model) => model.rows.map((item, index) => ({
                            key: JSON.stringify([model.provider, model.model, item.effort, item.fast ?? null]),
                            label: `${agentLabel} ${model.provider} ${model.model} ${item.effort || 'effort 미기록'} Fast ${fastLabel(item.fast)} 사용량`,
                            cells: [index ? '' : `${model.provider} · ${model.model}`, item.effort || '미기록',
                                fastLabel(item.fast), speed(item.outputTokensPerSecond), number(item.turns),
                                number(item.tokens), item.costUnpricedTurns === item.turns ? '미확인' : money(item.costUsd)] })))} />
                </Card>;
            })}
            {!data.efforts?.length && <Text style={muted}>선택한 기간에 Effort·Fast별 상세 기록이 없습니다.</Text>}
            <Text style={{ ...muted, fontSize: 11 }}>과거 기록은 추정하지 않고 미기록으로 표시하며, 상세 기록이 없는 합계는 이 분류에 포함되지 않을 수 있어요.</Text>
            </>}
        </>}
    </ScrollView>;
}
