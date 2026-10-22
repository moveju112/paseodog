import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  routeCommand,
  type EngineCommand,
  type EngineSnapshot,
  type FallbackRoute,
} from "./ai-engine-contract";
import { useAiEngineSettings } from "./use-ai-engine-settings";
import { EngineAccounts } from "./engine-accounts";

// 호스트 설정 목록의 개별 항목과 1:1로 대응하는 엔진 설정 구역
export type EngineSection =
  | "accounts"
  | "workflow"
  | "tokens"
  | "instructions"
  | "tools"
  | "skills"
  | "agents";

const modes = [
  { value: "none", label: "단독" },
  { value: "swarm", label: "협업" },
] as const;

const modeDescriptions: Record<EngineSnapshot["orchestration"], string> = {
  none: "서브에이전트 없이 메인 모델이 단독으로 모든 작업을 처리해요.",
  swarm: "여러 서브에이전트를 병렬 스웜으로 동시 실행해 대규모 작업을 빠르게 처리해요.",
};

const bufferOptions = [
  { value: "0.1", label: "10% · 맥락 최대 유지" },
  { value: "0.2", label: "20% · 균형 (권장)" },
  { value: "0.25", label: "25% · 토큰 최대 절감" },
] as const;

const idleOptions = [
  { value: "1800000", label: "30분" },
  { value: "3600000", label: "1시간" },
  { value: "7200000", label: "2시간" },
  { value: "21600000", label: "6시간" },
] as const;

const minContextOptions = [
  { value: "30", label: "30% 이상" },
  { value: "50", label: "50% 이상" },
  { value: "70", label: "70% 이상" },
] as const;

const inputStyle = {
  borderWidth: 1,
  borderColor: "rgba(140, 140, 150, 0.35)",
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
} as const;

const layout = {
  page: { gap: 16 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  control: { maxWidth: "60%", minWidth: 0 },
  panel: { padding: 14, gap: 12 },
  form: { padding: 14, gap: 12, marginTop: 12 },
  actions: { gap: 8, flexWrap: "wrap" },
  formActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", alignItems: "center" },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    gap: 8,
  },
  bodyInput: { minHeight: 200, textAlignVertical: "top", fontFamily: "monospace" },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  listItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listItemBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(130, 130, 145, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  listItemDimmed: {
    opacity: 0.45,
  },
  modalBody: {
    gap: 16,
  },
  fieldBlock: {
    gap: 6,
  },
  modelChainCard: {
    borderWidth: 1,
    borderColor: "rgba(140, 140, 150, 0.3)",
    borderRadius: 10,
    overflow: "hidden",
  },
  modelChainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
} as const;

type EngineRequest = (command: EngineCommand) => Promise<boolean>;
interface SectionProps {
  snapshot: EngineSnapshot;
  disabled: boolean;
  busy: boolean;
  request: EngineRequest;
}

// 기존 호스트 설정 행과 동일한 형태로 제목·설명·컨트롤을 배치한다.
function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <View style={layout.control}>{children}</View>
    </View>
  );
}

// 선택 항목 하나를 렌더링하고 선택 시 해당 값만 전달한다.
function SelectOption({
  option,
  selected,
  onChange,
}: {
  option: { value: string; label: string };
  selected: boolean;
  onChange: (value: string) => void;
}) {
  const handleSelect = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <DropdownMenuItem onSelect={handleSelect}>
      {selected ? `✓ ${option.label}` : option.label}
    </DropdownMenuItem>
  );
}

// 앱 기본 선택창을 사용해 긴 선택 목록을 설정 본문에서 분리한다.
function Select({
  title,
  value,
  options,
  disabled,
  onChange,
}: {
  title: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownTrigger
        size="sm"
        disabled={disabled || options.length === 0}
        accessibilityLabel={title}
      >
        {options.find((option) => option.value === value)?.label || value || "선택"}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="end" width={280} scrollable>
        {options.map((option) => (
          <SelectOption
            key={option.value}
            option={option}
            selected={option.value === value}
            onChange={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const instructionModeOptions = [
  { value: "all", label: "자동 (Claude → CLAUDE.md, Codex → AGENTS.md)" },
  { value: "agents", label: "AGENTS.md만" },
  { value: "claude", label: "CLAUDE.md만" },
  { value: "off", label: "사용 안 함" },
] as const;

const contextPercentOptions = [
  { value: "100", label: "100% (최대 컨텍스트)" },
  { value: "85", label: "85%" },
  { value: "70", label: "70%" },
  { value: "50", label: "50% (비용 절감)" },
] as const;

const bufferTokenOptions = [
  { value: "0", label: "비율 기준 사용 (기본)" },
  { value: "16000", label: "16,000 토큰 고정" },
  { value: "32000", label: "32,000 토큰 고정" },
  { value: "64000", label: "64,000 토큰 고정" },
] as const;

const memoryTimeoutOptions = [
  { value: "15000", label: "15초" },
  { value: "30000", label: "30초 (기본)" },
  { value: "60000", label: "60초" },
] as const;

const languageOptions = [
  { value: "", label: "자동 (시스템 기본)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "en", label: "English (en)" },
  { value: "ja", label: "日本語 (ja)" },
] as const;

const experienceOptions = [
  { value: "", label: "자동" },
  { value: "beginner", label: "입문자 (상세한 설명)" },
  { value: "intermediate", label: "중급 개발자" },
  { value: "senior", label: "시니어·아키텍트 (핵심 위주)" },
] as const;

const branchPrefixOptions = [
  { value: "paseodog/", label: "paseodog/" },
  { value: "mixdog/", label: "mixdog/" },
  { value: "feat/", label: "feat/" },
  { value: "task/", label: "task/" },
] as const;

const shellOptions = [
  { value: "", label: "시스템 기본 쉘 ($SHELL)" },
  { value: "/bin/bash", label: "/bin/bash" },
  { value: "/bin/zsh", label: "/bin/zsh" },
  { value: "/bin/sh", label: "/bin/sh" },
] as const;

const hookEventOptions = [
  { value: "PreToolUse", label: "도구 실행 전 (PreToolUse)" },
  { value: "PostToolUse", label: "도구 실행 후 (PostToolUse)" },
  { value: "Stop", label: "응답 완료 시 (Stop)" },
] as const;

const builtinToolMeta = [
  { id: "git", label: "Git 도구", hint: "상태 조회·커밋·브랜치 내장 도구" },
  { id: "office", label: "Office 문서 도구", hint: "PDF·문서·스프레드시트 처리" },
  { id: "tidy", label: "코드 정리 (Tidy)", hint: "포맷팅·린트 자동 정리" },
  { id: "visualize", label: "시각화 도구", hint: "다이어그램·구조 시각화 생성" },
  { id: "media", label: "미디어 처리", hint: "이미지·오디오 파일 분석 및 변환" },
  { id: "localProvider", label: "로컬 모델 공급자", hint: "Ollama·LM Studio 등 로컬 추론 연결" },
] as const;

const defaultEffortLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

// 추론 수준 ID를 사람이 읽기 쉬운 레이블로 변환한다 (low -> Low).
function formatEffortLabel(
  effort: string | null | undefined,
  autoEffort?: boolean,
  modelMeta?: EngineSnapshot["models"][number],
): string {
  if (autoEffort) return "Auto";
  if (!effort) return "Medium";
  const matched = modelMeta?.effortOptions.find((opt) => opt.id === effort);
  if (matched) return matched.label;
  return defaultEffortLabels[effort] || effort;
}

// 에이전트 라우트 정보를 Mixdog 스타일 한 줄 요약(모델명 + 추론 수준)으로 포맷한다.
function formatRouteSubtitle(
  route: EngineSnapshot["route"],
  models: EngineSnapshot["models"],
): string {
  const modelMeta = models.find(
    (item) => item.provider === route.provider && item.id === route.model,
  );
  const modelLabel = modelMeta?.label || route.model || "기본 모델";
  const effortLabel = formatEffortLabel(route.effort, route.autoEffort, modelMeta);
  const fallbackCount = route.fallbacks?.length ?? 0;
  const fallbackSuffix = fallbackCount > 0 ? ` (+폴백 ${fallbackCount})` : "";
  return `${modelLabel} ${effortLabel}${route.fast ? " · Fast" : ""}${fallbackSuffix}`;
}

// Web Search 라우트를 Mixdog 스타일 한 줄 요약으로 포맷한다.
function formatWebSearchSubtitle(
  wsRoute: EngineSnapshot["webSearchRoute"],
  mainRoute: EngineSnapshot["route"],
  models: EngineSnapshot["models"],
): string {
  const provider = wsRoute?.effectiveProvider || wsRoute?.provider || mainRoute.provider;
  const modelId = wsRoute?.effectiveModel || wsRoute?.model || mainRoute.model;
  const effort = wsRoute?.effectiveEffort || wsRoute?.effort || "medium";
  const modelMeta = models.find((item) => item.provider === provider && item.id === modelId);
  const modelLabel = modelMeta?.label || modelId || "GPT-5.4-Mini";
  const effortLabel = formatEffortLabel(effort, false, modelMeta);
  return `${modelLabel} ${effortLabel}`;
}

// 모델 공급자에 맞는 아이콘 기호 반환 (Claude -> ✻, OpenAI/Codex -> ◎)
function providerGlyph(provider: string | undefined, modelId?: string): string {
  const lower = `${provider || ""} ${modelId || ""}`.toLowerCase();
  if (lower.includes("anthropic") || lower.includes("claude")) return "✻";
  return "◎";
}

// 지침 파일 로딩 켜기·끄기 및 모델별 자동 분기 설정
function InstructionsSection({ snapshot, disabled, request }: SectionProps) {
  const mode = snapshot.instructionFiles;
  const enabled = !!mode && mode !== "off";

  const toggle = useCallback(
    (next: boolean) => {
      void request({ action: "instructionFiles", enabled: next });
    },
    [request],
  );
  const selectInstructionMode = useCallback(
    (instructionMode: string) => {
      if (
        instructionMode === "all" ||
        instructionMode === "agents" ||
        instructionMode === "claude" ||
        instructionMode === "off"
      ) {
        void request({ action: "instructionFiles", instructionMode });
      }
    },
    [request],
  );

  return (
    <SettingsSection title="지침 파일">
      <View style={settingsStyles.card}>
        <SettingRow
          title="지침 파일 로딩"
          hint="전역 ~/.codex/AGENTS.md · ~/.claude/CLAUDE.md와 프로젝트 AGENTS.md · CLAUDE.md를 모델 컨텍스트에 불러와요. (Claude는 CLAUDE.md, Codex는 AGENTS.md를 자동으로 바라봐요)"
        >
          <Switch
            accessibilityLabel="지침 파일 로딩"
            disabled={disabled || mode === undefined}
            value={enabled}
            onValueChange={toggle}
          />
        </SettingRow>
        {mode !== undefined && (
          <SettingRow
            title="지침 파일 범위"
            hint="자동(모델별 CLAUDE.md / AGENTS.md 자동 선택) 또는 특정 지침 파일만 강제 지정해요."
          >
            <Select
              title="지침 파일 범위"
              disabled={disabled}
              value={mode}
              options={instructionModeOptions}
              onChange={selectInstructionMode}
            />
          </SettingRow>
        )}
      </View>
      <Text style={settingsStyles.rowHint}>변경 사항은 새 세션부터 적용돼요.</Text>
      {enabled && mode !== "all" && (
        <Text style={settingsStyles.rowHint}>
          {`현재 일부 지침 파일만 불러오는 설정(${mode})이에요. 끄거나 다시 켜면 전체 로딩으로 바뀌어요.`}
        </Text>
      )}
      {mode === undefined && (
        <Text style={settingsStyles.rowError}>
          이 호스트의 AI 엔진은 지침 파일 설정을 지원하지 않아요. 서버를 업데이트해 주세요.
        </Text>
      )}
    </SettingsSection>
  );
}

// 내장 도구 모듈 전용 설정 구역 (웹 검색·장기 메모리·Git·Office·Tidy·Visualize·Media·Local)
function ToolsSection({ snapshot, disabled, request }: SectionProps) {
  const toolModules = snapshot.toolModules;
  const uninstalledModules = builtinToolMeta.filter(
    (tool) => toolModules?.[tool.id]?.installed === false,
  );

  return (
    <SettingsSection title="내장 도구 모듈 (Built-in Tools)">
      <View style={settingsStyles.card}>
        <SettingRow title="웹 검색 도구" hint="실시간 웹 검색 및 문서 조회 허용">
          <Switch
            accessibilityLabel="웹 검색 도구"
            disabled={disabled}
            value={toolModules?.webSearch ?? true}
            onValueChange={(webSearch) => void request({ action: "features", webSearch })}
          />
        </SettingRow>
        <SettingRow title="장기 메모리 도구" hint="세션 간 핵심 사실·선호도 기억 도구 활성화">
          <Switch
            accessibilityLabel="장기 메모리 도구"
            disabled={disabled}
            value={toolModules?.memory?.enabled ?? true}
            onValueChange={(memoryTools) => void request({ action: "features", memoryTools })}
          />
        </SettingRow>
        {builtinToolMeta.map((tool) => (
          <SettingRow key={tool.id} title={tool.label} hint={tool.hint}>
            <Switch
              accessibilityLabel={tool.label}
              disabled={disabled}
              value={toolModules?.[tool.id]?.enabled ?? true}
              onValueChange={(toolEnabled) =>
                void request({
                  action: "features",
                  builtinTool: tool.id,
                  enabled: toolEnabled,
                })
              }
            />
          </SettingRow>
        ))}
        {uninstalledModules.map((pack) => (
          <SettingRow
            key={`install-${pack.id}`}
            title={`확장 팩 · ${pack.label}`}
            hint="필요 시 호스트에 즉시 설치"
          >
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onPress={() => void request({ action: "features", installFeature: pack.id })}
            >
              설치
            </Button>
          </SettingRow>
        ))}
      </View>
    </SettingsSection>
  );
}

// 스킬 및 라이프사이클 훅 전용 설정 구역 (기본값 전부 OFF)
function SkillsSection({ snapshot, disabled, request }: SectionProps) {
  const [addingHook, setAddingHook] = useState(false);
  const [hookEvent, setHookEvent] = useState("PostToolUse");
  const [hookCommand, setHookCommand] = useState("");
  const [hookPattern, setHookPattern] = useState("");

  const skills = snapshot.skills?.items ?? [];
  const rawDisabledSkills = snapshot.skills?.disabled ?? [];
  const disabledSkillSet = useMemo(() => new Set(rawDisabledSkills), [rawDisabledSkills]);
  const wildcardDisabled = disabledSkillSet.has("*");
  const hooks = snapshot.hooks?.rules ?? [];

  const toggleSkill = useCallback(
    (skillName: string, nextEnabled: boolean) => {
      const allNames = (snapshot.skills?.items ?? []).map((item) => item.name);
      const raw = snapshot.skills?.disabled ?? [];
      const currentDisabled = new Set(raw.includes("*") ? allNames : raw);
      if (nextEnabled) currentDisabled.delete(skillName);
      else currentDisabled.add(skillName);
      void request({ action: "preferences", disabledSkills: [...currentDisabled] });
    },
    [request, snapshot.skills],
  );

  const createHook = useCallback(async () => {
    if (!hookCommand.trim()) return;
    const saved = await request({
      action: "preferences",
      hookAction: "add",
      hookRule: {
        event: hookEvent,
        command: hookCommand.trim(),
        ...(hookPattern.trim() ? { matcher: hookPattern.trim() } : {}),
      },
    });
    if (!saved) return;
    setHookCommand("");
    setHookPattern("");
    setAddingHook(false);
  }, [hookCommand, hookEvent, hookPattern, request]);

  return (
    <SettingsSection title="스킬 및 훅 (Skills & Lifecycle Hooks)">
      <View style={settingsStyles.card}>
        {skills.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>등록된 스킬이 없어요.</Text>
          </View>
        ) : (
          skills.map((skill) => {
            const skillEnabled =
              !skill.disabled && !wildcardDisabled && !disabledSkillSet.has(skill.name);
            return (
              <SettingRow
                key={skill.name}
                title={`스킬 · ${skill.name}`}
                hint={skill.description || skill.name}
              >
                <Switch
                  accessibilityLabel={`스킬 ${skill.name}`}
                  disabled={disabled}
                  value={skillEnabled}
                  onValueChange={(next) => toggleSkill(skill.name, next)}
                />
              </SettingRow>
            );
          })
        )}
        {hooks.map((hook) => (
          <SettingRow
            key={String(hook.index)}
            title={`훅 · ${hook.event}${hook.matcher ? ` (${hook.matcher})` : ""}`}
            hint={hook.command}
          >
            <View style={layout.formActions}>
              <Switch
                accessibilityLabel={`훅 ${hook.index}`}
                disabled={disabled}
                value={hook.enabled}
                onValueChange={(next) =>
                  void request({
                    action: "preferences",
                    hookAction: "toggle",
                    hookIndex: hook.index,
                    enabled: next,
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onPress={() =>
                  void request({
                    action: "preferences",
                    hookAction: "delete",
                    hookIndex: hook.index,
                  })
                }
              >
                삭제
              </Button>
            </View>
          </SettingRow>
        ))}
        <View style={[settingsStyles.row, settingsStyles.rowBorder, layout.actions]}>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onPress={() => setAddingHook((current) => !current)}
          >
            {addingHook ? "훅 추가 닫기" : "+ 새 훅 규칙"}
          </Button>
        </View>
      </View>
      {addingHook && (
        <View style={[settingsStyles.card, layout.form]}>
          <Text style={settingsStyles.rowTitle}>새 라이프사이클 훅 추가</Text>
          <SettingRow title="이벤트 시점">
            <Select
              title="훅 이벤트 선택"
              disabled={disabled}
              value={hookEvent}
              options={hookEventOptions}
              onChange={setHookEvent}
            />
          </SettingRow>
          <AdaptiveTextInput
            accessibilityLabel="훅 실행 명령어"
            initialValue={hookCommand}
            onChangeText={setHookCommand}
            placeholder="실행할 쉘 명령어 (예: npm run lint)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={[settingsStyles.rowTitle, inputStyle]}
          />
          <AdaptiveTextInput
            accessibilityLabel="훅 도구 패턴"
            initialValue={hookPattern}
            onChangeText={setHookPattern}
            placeholder="대상 도구 패턴 (선택, 예: Write|Edit)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={[settingsStyles.rowTitle, inputStyle]}
          />
          <View style={layout.formActions}>
            <Button size="sm" variant="ghost" onPress={() => setAddingHook(false)}>
              취소
            </Button>
            <Button size="sm" disabled={disabled || !hookCommand.trim()} onPress={createHook}>
              훅 저장
            </Button>
          </View>
        </View>
      )}
    </SettingsSection>
  );
}

// 오케스트레이션 모드 선택 카드
function OrchestrationCard({
  mode,
  request,
}: {
  mode: EngineSnapshot["orchestration"];
  request: EngineRequest;
}) {
  const setMode = useCallback(
    (next: EngineSnapshot["orchestration"]) => {
      void request({ action: "orchestration", mode: next });
    },
    [request],
  );
  return (
    <SettingsSection title="자동 오케스트레이터 (Orchestration)">
      <View style={[settingsStyles.card, layout.panel]}>
        <SegmentedControl<EngineSnapshot["orchestration"]>
          value={mode}
          options={[...modes]}
          onValueChange={setMode}
        />
        <Text style={settingsStyles.rowHint}>{modeDescriptions[mode]}</Text>
      </View>
    </SettingsSection>
  );
}

// 에이전트 목록 한 줄 (클릭 시 모달 편집기 오픈, 비활성 시 흐리게 표시)
function AgentListRow({
  agent,
  models,
  disabled,
  onPress,
}: {
  agent: EngineSnapshot["agents"][number];
  models: EngineSnapshot["models"];
  disabled: boolean;
  onPress: (agent: EngineSnapshot["agents"][number]) => void;
}) {
  const handlePress = useCallback(() => onPress(agent), [agent, onPress]);
  const glyph = providerGlyph(agent.route.provider, agent.route.model);
  const subtitle = formatRouteSubtitle(agent.route, models);
  return (
    <Pressable
      accessibilityLabel={`에이전트 ${agent.label}`}
      disabled={disabled}
      onPress={handlePress}
      style={[
        settingsStyles.row,
        settingsStyles.rowBorder,
        layout.listItemRow,
        agent.disabled && layout.listItemDimmed,
      ]}
    >
      <View style={layout.listItemBadge}>
        <Text style={settingsStyles.rowTitle}>{glyph}</Text>
      </View>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{agent.label}</Text>
        <Text style={settingsStyles.rowHint}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

// Mixdog 스타일 통합 워크플로우 화면 (작업 규칙 리스트+모달 · 기본 에이전트 · 서브에이전트 리스트+모달 · 오케스트레이션 · 실행 환경)
function WorkflowSection({ snapshot, disabled, request }: SectionProps) {
  // 작업 규칙(Workflow) 모달 상태
  const [workflowModalMode, setWorkflowModalMode] = useState<"edit" | "create" | null>(null);
  const [editingWorkflowId, setEditingWorkflowId] = useState("default");
  const [wfNewId, setWfNewId] = useState("");
  const [wfName, setWfName] = useState("");
  const [wfDesc, setWfDesc] = useState("");
  const [wfBody, setWfBody] = useState("");
  const [wfActive, setWfActive] = useState(true);
  const [wfRevision, setWfRevision] = useState(0);

  // Web Search 기본 에이전트 모달 상태
  const [webSearchModalOpen, setWebSearchModalOpen] = useState(false);
  const [wsEnabled, setWsEnabled] = useState(true);
  const [wsModelValue, setWsModelValue] = useState("");
  const [wsEffortValue, setWsEffortValue] = useState("medium");

  // 에이전트 편집/생성 모달 상태
  const [agentModalMode, setAgentModalMode] = useState<"edit" | "create" | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [newAgentId, setNewAgentId] = useState("");
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentBody, setAgentBody] = useState("");
  const [agentProvider, setAgentProvider] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [agentEffort, setAgentEffort] = useState<string | null>("medium");
  const [agentAutoEffort, setAgentAutoEffort] = useState(false);
  const [agentFast, setAgentFast] = useState(false);
  const [agentFallbacks, setAgentFallbacks] = useState<FallbackRoute[]>([]);
  const [agentRevision, setAgentRevision] = useState(0);

  // 서버에서 workflowPack 또는 agentDefinition 응답이 오면 열린 모달의 본문을 갱신한다.
  useEffect(() => {
    if (
      workflowModalMode === "edit" &&
      snapshot.workflowPack &&
      snapshot.workflowPack.id === editingWorkflowId
    ) {
      setWfName(snapshot.workflowPack.name || editingWorkflowId);
      setWfDesc(snapshot.workflowPack.description || "");
      setWfBody(snapshot.workflowPack.body || "");
      setWfRevision((r) => r + 1);
    }
  }, [editingWorkflowId, snapshot.workflowPack, workflowModalMode]);

  useEffect(() => {
    if (
      agentModalMode === "edit" &&
      editingAgentId &&
      snapshot.agentDefinition &&
      snapshot.agentDefinition.id === editingAgentId
    ) {
      setAgentBody(snapshot.agentDefinition.body || "");
      setAgentRevision((r) => r + 1);
    }
  }, [agentModalMode, editingAgentId, snapshot.agentDefinition]);

  // 작업 규칙 클릭 -> 모달 편집기 오픈
  const openEditWorkflowModal = useCallback(
    (item: EngineSnapshot["workflows"][number]) => {
      if (item.id === "none") {
        void request({ action: "workflow", workflow: "none" });
        return;
      }
      setEditingWorkflowId(item.id);
      setWfName(item.name || item.id);
      setWfDesc(item.description || "");
      const initialBody =
        item.body ?? (snapshot.workflowPack?.id === item.id ? snapshot.workflowPack.body : "");
      setWfBody(initialBody);
      setWfActive(item.active);
      setWfRevision((r) => r + 1);
      setWorkflowModalMode("edit");
      if (!item.body) {
        void request({ action: "workflowPack", workflow: item.id });
      }
    },
    [request, snapshot.workflowPack],
  );

  // + 버튼 클릭 -> 새 작업 규칙 모달 오픈
  const openCreateWorkflowModal = useCallback(() => {
    setWfNewId("");
    setWfName("");
    setWfDesc("");
    setWfBody("");
    setWfActive(true);
    setWfRevision((r) => r + 1);
    setWorkflowModalMode("create");
  }, []);

  const closeWorkflowModal = useCallback(() => setWorkflowModalMode(null), []);

  const saveWorkflowModal = useCallback(async () => {
    if (workflowModalMode === "edit") {
      const saved = await request({
        action: "workflowSave",
        workflow: editingWorkflowId,
        name: wfName.trim() || editingWorkflowId,
        description: wfDesc.trim(),
        body: wfBody,
        activate: wfActive,
      });
      if (saved) setWorkflowModalMode(null);
      return;
    }
    if (workflowModalMode === "create") {
      const rawSlug = wfNewId.trim() || wfName.trim();
      const cleanId = rawSlug
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (!cleanId) return;
      const saved = await request({
        action: "workflowCreate",
        workflow: cleanId,
        name: wfName.trim() || cleanId,
        description: wfDesc.trim(),
        ...(wfBody.trim() ? { body: wfBody } : {}),
        activate: wfActive,
      });
      if (saved) setWorkflowModalMode(null);
    }
  }, [
    editingWorkflowId,
    request,
    snapshot.workflows,
    wfActive,
    wfBody,
    wfDesc,
    wfName,
    wfNewId,
    workflowModalMode,
  ]);

  const deleteWorkflowModal = useCallback(async () => {
    if (!editingWorkflowId || editingWorkflowId === "default") return;
    if (await request({ action: "workflowDelete", workflow: editingWorkflowId }))
      setWorkflowModalMode(null);
  }, [editingWorkflowId, request]);

  // Web Search 모달 열기/저장
  const openWebSearchModal = useCallback(() => {
    const ws = snapshot.webSearchRoute;
    const provider = ws?.effectiveProvider || ws?.provider || snapshot.route.provider;
    const model = ws?.effectiveModel || ws?.model || snapshot.route.model;
    setWsEnabled(snapshot.toolModules?.webSearch ?? true);
    setWsModelValue(ws?.inherited ? "" : `${provider}/${model}`);
    setWsEffortValue(ws?.effectiveEffort || ws?.effort || "medium");
    setWebSearchModalOpen(true);
  }, [
    snapshot.route.model,
    snapshot.route.provider,
    snapshot.toolModules?.webSearch,
    snapshot.webSearchRoute,
  ]);

  const closeWebSearchModal = useCallback(() => setWebSearchModalOpen(false), []);

  const saveWebSearchModal = useCallback(async () => {
    const chosen = snapshot.models.find((m) => `${m.provider}/${m.id}` === wsModelValue);
    const saved = await request({
      action: "features",
      webSearch: wsEnabled,
      webSearchRoute: chosen
        ? {
            inherited: false,
            provider: chosen.provider,
            model: chosen.id,
            effort: wsEffortValue,
          }
        : { inherited: true },
    });
    if (saved) setWebSearchModalOpen(false);
  }, [request, snapshot.models, wsEffortValue, wsEnabled, wsModelValue]);

  // 에이전트 행 클릭 -> 에이전트 편집 모달 오픈
  const openEditAgentModal = useCallback(
    (agent: EngineSnapshot["agents"][number]) => {
      setEditingAgentId(agent.id);
      setAgentEnabled(!agent.disabled);
      setAgentName(agent.label || agent.id);
      setAgentDesc(agent.description || "");
      setAgentBody(agent.body || "");
      setAgentProvider(agent.route.provider);
      setAgentModel(agent.route.model);
      setAgentEffort(agent.route.effort ?? "medium");
      setAgentAutoEffort(Boolean(agent.route.autoEffort));
      setAgentFast(Boolean(agent.route.fast));
      setAgentFallbacks(agent.route.fallbacks ? [...agent.route.fallbacks] : []);
      setAgentRevision((r) => r + 1);
      setAgentModalMode("edit");
      if (!agent.body) {
        void request({ action: "agentDefinition", agent: agent.id });
      }
    },
    [request],
  );

  // + 버튼 클릭 -> 새 에이전트 모달 오픈
  const openCreateAgentModal = useCallback(() => {
    const defaultModel = snapshot.models[0];
    setEditingAgentId(null);
    setNewAgentId("");
    setAgentEnabled(false);
    setAgentName("");
    setAgentDesc("");
    setAgentBody("");
    setAgentProvider(defaultModel?.provider || snapshot.route.provider);
    setAgentModel(defaultModel?.id || snapshot.route.model);
    setAgentEffort("medium");
    setAgentAutoEffort(false);
    setAgentFast(false);
    setAgentFallbacks([]);
    setAgentRevision((r) => r + 1);
    setAgentModalMode("create");
  }, [snapshot.models, snapshot.route.model, snapshot.route.provider]);

  const closeAgentModal = useCallback(() => {
    setAgentModalMode(null);
    setEditingAgentId(null);
  }, []);

  // 모달 상단 ON/OFF 토글 변경 (편집 모드에서는 즉시 반영 + 로컬 상태 갱신)
  const handleToggleAgentEnabled = useCallback(
    (nextEnabled: boolean) => {
      setAgentEnabled(nextEnabled);
      if (agentModalMode === "edit" && editingAgentId) {
        void request(routeCommand(editingAgentId, { disabled: !nextEnabled }));
      }
    },
    [agentModalMode, editingAgentId, request],
  );

  // 에이전트 주 모델 변경
  const handleSelectAgentModel = useCallback(
    (value: string) => {
      const chosen = snapshot.models.find((m) => `${m.provider}/${m.id}` === value);
      if (!chosen) return;
      setAgentProvider(chosen.provider);
      setAgentModel(chosen.id);
    },
    [snapshot.models],
  );

  // 에이전트 추론 수준 변경 ("auto" 선택 시 autoEffort: true)
  const handleSelectAgentEffort = useCallback((value: string) => {
    if (value === "auto") {
      setAgentAutoEffort(true);
    } else {
      setAgentAutoEffort(false);
      setAgentEffort(value);
    }
  }, []);

  // 폴백 모델 추가 (+)
  const addFallbackModel = useCallback(() => {
    const candidate =
      snapshot.models.find((m) => m.id !== agentModel || m.provider !== agentProvider) ||
      snapshot.models[0];
    if (!candidate) return;
    setAgentFallbacks((current) => [
      ...current,
      { provider: candidate.provider, model: candidate.id, effort: "medium", fast: false },
    ]);
  }, [agentModel, agentProvider, snapshot.models]);

  // 폴백 모델 변경
  const updateFallbackModel = useCallback(
    (index: number, value: string) => {
      const chosen = snapshot.models.find((m) => `${m.provider}/${m.id}` === value);
      if (!chosen) return;
      setAgentFallbacks((current) =>
        current.map((item, idx) =>
          idx === index ? { ...item, provider: chosen.provider, model: chosen.id } : item,
        ),
      );
    },
    [snapshot.models],
  );

  // 폴백 추론 수준 변경
  const updateFallbackEffort = useCallback((index: number, effort: string) => {
    setAgentFallbacks((current) =>
      current.map((item, idx) => (idx === index ? { ...item, effort } : item)),
    );
  }, []);

  // 폴백 모델 제거
  const removeFallbackModel = useCallback((index: number) => {
    setAgentFallbacks((current) => current.filter((_, idx) => idx !== index));
  }, []);

  // 에이전트 모달 저장 (라우트 + 활성 여부 + AGENT.md 본문 통합 저장)
  const saveAgentModal = useCallback(async () => {
    const routePatch = {
      provider: agentProvider,
      model: agentModel,
      effort: agentEffort,
      autoEffort: agentAutoEffort,
      fast: agentFast,
      disabled: !agentEnabled,
      fallbacks: agentFallbacks,
    };
    if (agentModalMode === "edit" && editingAgentId) {
      const saved = await request({
        action: "agentSave",
        agent: editingAgentId,
        name: agentName.trim() || editingAgentId,
        description: agentDesc.trim(),
        body: agentBody.trim()
          ? agentBody
          : `---\nname: ${agentName.trim() || editingAgentId}\ndescription: ${agentDesc.trim()}\n---\n\nYou are the ${agentName.trim() || editingAgentId} agent.\n`,
        route: routePatch,
      });
      if (saved) closeAgentModal();
      return;
    }
    if (agentModalMode === "create") {
      const rawSlug = newAgentId.trim() || agentName.trim();
      const cleanId =
        rawSlug
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || `agent-${Date.now()}`;
      const saved = await request({
        action: "agentCreate",
        agent: cleanId,
        name: agentName.trim() || cleanId,
        description: agentDesc.trim(),
        body: agentBody.trim()
          ? agentBody
          : `---\nname: ${agentName.trim() || cleanId}\ndescription: ${agentDesc.trim()}\n---\n\nYou are the ${agentName.trim() || cleanId} agent.\n`,
        route: routePatch,
      });
      if (saved) closeAgentModal();
    }
  }, [
    agentAutoEffort,
    agentBody,
    agentDesc,
    agentEffort,
    agentEnabled,
    agentFallbacks,
    agentFast,
    agentModalMode,
    agentModel,
    agentName,
    agentProvider,
    closeAgentModal,
    editingAgentId,
    newAgentId,
    request,
  ]);

  // 에이전트 삭제/초기화
  const deleteAgentModal = useCallback(async () => {
    if (!editingAgentId) return;
    if (await request({ action: "agentDelete", agent: editingAgentId })) closeAgentModal();
  }, [closeAgentModal, editingAgentId, request]);

  const maintainerAgent = snapshot.agents.find((item) => item.id === "maintainer");
  const subAgents = snapshot.agents.filter((item) => item.id !== "maintainer");
  const editingAgentTarget = snapshot.agents.find((item) => item.id === editingAgentId);

  const modelOptions = useMemo(
    () =>
      snapshot.models.map((item) => ({
        value: `${item.provider}/${item.id}`,
        label: `${item.label} · ${item.provider}`,
      })),
    [snapshot.models],
  );

  const wsModelOptions = useMemo(
    () => [{ value: "", label: "기본 모델 상속" }, ...modelOptions],
    [modelOptions],
  );

  const currentAgentModelMeta = snapshot.models.find(
    (item) => item.provider === agentProvider && item.id === agentModel,
  );
  const agentEffortOptions = useMemo(() => {
    const base =
      currentAgentModelMeta?.effortOptions && currentAgentModelMeta.effortOptions.length > 0
        ? currentAgentModelMeta.effortOptions.map((item) => ({
            value: item.id,
            label: item.label,
          }))
        : [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "xhigh", label: "XHigh" },
          ];
    return [{ value: "auto", label: "Auto" }, ...base];
  }, [currentAgentModelMeta]);

  const outputStyleOptions = (snapshot.outputStyles ?? []).map((item) => ({
    value: item.id,
    label: item.label,
  }));

  const workflowSheetHeader = useMemo(
    () => ({
      title: workflowModalMode === "create" ? "새 작업 규칙" : "작업 규칙 편집",
      actions: (
        <Switch
          accessibilityLabel="작업 규칙 활성화"
          disabled={disabled}
          value={wfActive}
          onValueChange={setWfActive}
        />
      ),
    }),
    [disabled, wfActive, workflowModalMode],
  );

  const webSearchSheetHeader = useMemo(
    () => ({
      title: "Web Search 편집",
      actions: (
        <Switch
          accessibilityLabel="웹 검색 에이전트 사용"
          disabled={disabled}
          value={wsEnabled}
          onValueChange={setWsEnabled}
        />
      ),
    }),
    [disabled, wsEnabled],
  );

  const agentSheetHeader = useMemo(
    () => ({
      title: agentModalMode === "create" ? "새 에이전트" : "에이전트 편집",
      actions: (
        <Switch
          accessibilityLabel="에이전트 사용"
          disabled={disabled}
          value={agentEnabled}
          onValueChange={handleToggleAgentEnabled}
        />
      ),
    }),
    [agentEnabled, agentModalMode, disabled, handleToggleAgentEnabled],
  );

  const wsActive = snapshot.toolModules?.webSearch ?? true;

  return (
    <>
      {/* 1. 작업 규칙 (Workflow Rules) */}
      <SettingsSection title="작업 규칙">
        <View style={layout.sectionHeaderRow}>
          <Text style={settingsStyles.rowHint}>에이전트가 따르는 작업 방식과 원칙입니다.</Text>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            accessibilityLabel="새 작업 규칙 추가"
            onPress={openCreateWorkflowModal}
          >
            +
          </Button>
        </View>
        <Text style={settingsStyles.rowHint}>
          기본값은 사용 안 함입니다. 사용 안 함은 WORKFLOW.md를 읽거나 대화 지침에 추가하지
          않습니다.
        </Text>
        <View style={settingsStyles.card}>
          {snapshot.workflows.map((item) => (
            <Pressable
              key={item.id}
              accessibilityLabel={`작업 규칙 ${item.name}`}
              disabled={disabled}
              onPress={() => openEditWorkflowModal(item)}
              style={[
                settingsStyles.row,
                settingsStyles.rowBorder,
                layout.listItemRow,
                !item.active && layout.listItemDimmed,
              ]}
            >
              <View style={layout.listItemBadge}>
                <Text style={settingsStyles.rowTitle}>≣</Text>
              </View>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {item.name}
                  {item.userOverride ? " (커스텀)" : ""}
                </Text>
                {item.description ? (
                  <Text style={settingsStyles.rowHint}>{item.description}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </SettingsSection>

      {/* 2. 기본 에이전트 (Web Search + Maintainer) */}
      <SettingsSection title="기본 에이전트">
        <Text style={settingsStyles.rowHint}>
          웹 검색과 설정 유지를 담당하는 기본 에이전트입니다.
        </Text>
        <View style={settingsStyles.card}>
          <Pressable
            accessibilityLabel="기본 에이전트 Web Search"
            disabled={disabled}
            onPress={openWebSearchModal}
            style={[
              settingsStyles.row,
              settingsStyles.rowBorder,
              layout.listItemRow,
              !wsActive && layout.listItemDimmed,
            ]}
          >
            <View style={layout.listItemBadge}>
              <Text style={settingsStyles.rowTitle}>
                {providerGlyph(
                  snapshot.webSearchRoute?.effectiveProvider || snapshot.route.provider,
                  snapshot.webSearchRoute?.effectiveModel || snapshot.route.model,
                )}
              </Text>
            </View>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Web Search</Text>
              <Text style={settingsStyles.rowHint}>
                {formatWebSearchSubtitle(snapshot.webSearchRoute, snapshot.route, snapshot.models)}
              </Text>
            </View>
          </Pressable>
          {maintainerAgent && (
            <AgentListRow
              agent={maintainerAgent}
              models={snapshot.models}
              disabled={disabled}
              onPress={openEditAgentModal}
            />
          )}
        </View>
      </SettingsSection>

      {/* 3. 에이전트 (Sub-agents) */}
      <SettingsSection title="에이전트">
        <View style={layout.sectionHeaderRow}>
          <Text style={settingsStyles.rowHint}>
            클릭하여 편집합니다. 비활성 에이전트는 흐리게 표시됩니다.
          </Text>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            accessibilityLabel="새 에이전트 추가"
            onPress={openCreateAgentModal}
          >
            +
          </Button>
        </View>
        <View style={settingsStyles.card}>
          {subAgents.map((agent) => (
            <AgentListRow
              key={agent.id}
              agent={agent}
              models={snapshot.models}
              disabled={disabled}
              onPress={openEditAgentModal}
            />
          ))}
        </View>
      </SettingsSection>

      {/* 4. 자동 오케스트레이터 */}
      <OrchestrationCard mode={snapshot.orchestration} request={request} />

      {/* 5. 출력 스타일 및 사용자 프로필 */}
      <SettingsSection title="출력 스타일 및 사용자 프로필">
        <View style={settingsStyles.card}>
          <SettingRow title="응답 출력 스타일" hint="모델의 답변 톤앤매너와 설명 밀도">
            <Select
              title="응답 출력 스타일"
              disabled={disabled}
              value={snapshot.outputStyle ?? ""}
              options={outputStyleOptions}
              onChange={(outputStyle) => void request({ action: "preferences", outputStyle })}
            />
          </SettingRow>
          <SettingRow title="선호 응답 언어" hint="모델이 기본으로 응답할 언어">
            <Select
              title="선호 응답 언어"
              disabled={disabled}
              value={snapshot.profile?.language ?? ""}
              options={languageOptions}
              onChange={(language) =>
                void request({ action: "preferences", profile: { language: language || "" } })
              }
            />
          </SettingRow>
          <SettingRow title="개발 숙련도 프로필" hint="설명 수준을 사용자 숙련도에 맞춤">
            <Select
              title="개발 숙련도 프로필"
              disabled={disabled}
              value={snapshot.profile?.experienceLevel ?? ""}
              options={experienceOptions}
              onChange={(experienceLevel) =>
                void request({
                  action: "preferences",
                  profile: { experienceLevel: experienceLevel || "" },
                })
              }
            />
          </SettingRow>
          <SettingRow
            title="AI 세션 제목 자동 생성"
            hint="첫 대화 내용을 바탕으로 세션 제목 자동 요약"
          >
            <Switch
              accessibilityLabel="AI 세션 제목 자동 생성"
              disabled={disabled}
              value={snapshot.aiSessionTitles ?? true}
              onValueChange={(aiSessionTitles) =>
                void request({ action: "preferences", aiSessionTitles })
              }
            />
          </SettingRow>
        </View>
      </SettingsSection>

      {/* 6. Git Worktree 및 실행 쉘 (기본값 OFF) */}
      <SettingsSection title="Git Worktree 및 실행 쉘">
        <View style={settingsStyles.card}>
          <SettingRow
            title="새 작업 시 Worktree 격리 기본 사용"
            hint="독립된 Git 워크트리에서 에이전트 작업을 안전하게 격리 (기본값: 꺼짐)"
          >
            <Switch
              accessibilityLabel="새 작업 시 Worktree 격리"
              disabled={disabled}
              value={snapshot.worktree?.newTaskDefault === "worktree"}
              onValueChange={(useWorktree) =>
                void request({
                  action: "preferences",
                  worktree: { newTaskDefault: useWorktree ? "worktree" : "branch" },
                })
              }
            />
          </SettingRow>
          <SettingRow title="Worktree 자동 정리" hint="작업 완료 후 임시 워크트리를 자동 정리">
            <Switch
              accessibilityLabel="Worktree 자동 정리"
              disabled={disabled}
              value={snapshot.worktree?.autoCleanup ?? true}
              onValueChange={(autoCleanup) =>
                void request({ action: "preferences", worktree: { autoCleanup } })
              }
            />
          </SettingRow>
          <SettingRow title="Worktree 브랜치 접두사" hint="자동 생성 브랜치 이름 규칙">
            <Select
              title="Worktree 브랜치 접두사"
              disabled={disabled}
              value={snapshot.worktree?.branchPrefix ?? "paseodog/"}
              options={branchPrefixOptions}
              onChange={(branchPrefix) =>
                void request({ action: "preferences", worktree: { branchPrefix } })
              }
            />
          </SettingRow>
          <SettingRow
            title="명령 실행 쉘"
            hint={
              snapshot.shell?.effective
                ? `현재: ${snapshot.shell.effective}`
                : "명령 실행에 사용할 기본 쉘"
            }
          >
            <Select
              title="명령 실행 쉘"
              disabled={disabled}
              value={snapshot.shell?.command ?? ""}
              options={shellOptions}
              onChange={(shellCommand) =>
                void request({ action: "preferences", shellCommand: shellCommand || "" })
              }
            />
          </SettingRow>
        </View>
      </SettingsSection>

      {/* 모달 1: 작업 규칙 편집 / 새 작업 규칙 */}
      <AdaptiveModalSheet
        visible={workflowModalMode !== null}
        header={workflowSheetHeader}
        onClose={closeWorkflowModal}
        desktopMaxWidth={560}
        testID="engine-workflow-edit-modal"
      >
        <View style={layout.modalBody}>
          {workflowModalMode === "create" && (
            <View style={layout.fieldBlock}>
              <Text style={settingsStyles.rowTitle}>ID (선택)</Text>
              <Text style={settingsStyles.rowHint}>
                비워두면 이름에서 자동으로 생성됩니다. (예: fast-dev)
              </Text>
              <AdaptiveTextInput
                accessibilityLabel="새 워크플로 ID"
                initialValue={wfNewId}
                resetKey={wfRevision}
                onChangeText={setWfNewId}
                placeholder="fast-dev"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                style={[settingsStyles.rowTitle, inputStyle]}
              />
            </View>
          )}
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>이름</Text>
            <Text style={settingsStyles.rowHint}>작업 규칙 목록에 표시됩니다.</Text>
            <AdaptiveTextInput
              accessibilityLabel={
                workflowModalMode === "create" ? "새 워크플로 이름" : "워크플로 이름"
              }
              initialValue={wfName}
              resetKey={wfRevision}
              onChangeText={setWfName}
              placeholder="Default"
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle]}
            />
          </View>
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>설명</Text>
            <Text style={settingsStyles.rowHint}>이 작업 규칙의 목적과 특징입니다.</Text>
            <AdaptiveTextInput
              accessibilityLabel={
                workflowModalMode === "create" ? "새 워크플로 설명" : "워크플로 설명"
              }
              initialValue={wfDesc}
              resetKey={wfRevision}
              onChangeText={setWfDesc}
              placeholder="계획·승인·검증 작업 진행 규칙"
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle]}
            />
          </View>
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>WORKFLOW.md</Text>
            <Text style={settingsStyles.rowHint}>
              에이전트가 따르는 작업 방식과 원칙을 정의하는 지침입니다.
            </Text>
            <AdaptiveTextInput
              accessibilityLabel={
                workflowModalMode === "create" ? "새 워크플로 본문" : "워크플로 본문"
              }
              initialValue={wfBody}
              resetKey={wfRevision}
              onChangeText={setWfBody}
              placeholder="사용할 WORKFLOW.md 지침을 작성하세요."
              multiline
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle, layout.bodyInput]}
            />
          </View>
          <View style={layout.modalFooter}>
            <View>
              {workflowModalMode === "edit" && editingWorkflowId !== "default" && (
                <Button size="sm" variant="ghost" disabled={disabled} onPress={deleteWorkflowModal}>
                  삭제
                </Button>
              )}
            </View>
            <View style={layout.formActions}>
              <Button size="sm" variant="ghost" onPress={closeWorkflowModal}>
                취소
              </Button>
              <Button
                size="sm"
                disabled={
                  disabled ||
                  (workflowModalMode === "create" && !wfName.trim() && !wfNewId.trim()) ||
                  (workflowModalMode === "edit" && !wfBody.trim())
                }
                onPress={saveWorkflowModal}
              >
                저장
              </Button>
            </View>
          </View>
        </View>
      </AdaptiveModalSheet>

      {/* 모달 2: Web Search 기본 에이전트 편집 */}
      <AdaptiveModalSheet
        visible={webSearchModalOpen}
        header={webSearchSheetHeader}
        onClose={closeWebSearchModal}
        desktopMaxWidth={520}
        testID="engine-websearch-edit-modal"
      >
        <View style={layout.modalBody}>
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>모델</Text>
            <Text style={settingsStyles.rowHint}>
              웹 검색 질의 생성 및 요약에 사용할 전용 모델입니다.
            </Text>
            <View style={layout.modelChainCard}>
              <View style={layout.modelChainRow}>
                <Select
                  title="Web Search 모델 선택"
                  disabled={disabled}
                  value={wsModelValue}
                  options={wsModelOptions}
                  onChange={setWsModelValue}
                />
                <Select
                  title="Web Search 추론 수준"
                  disabled={disabled}
                  value={wsEffortValue}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                  onChange={setWsEffortValue}
                />
              </View>
            </View>
          </View>
          <View style={layout.modalFooter}>
            <View />
            <View style={layout.formActions}>
              <Button size="sm" variant="ghost" onPress={closeWebSearchModal}>
                취소
              </Button>
              <Button size="sm" disabled={disabled} onPress={saveWebSearchModal}>
                저장
              </Button>
            </View>
          </View>
        </View>
      </AdaptiveModalSheet>

      {/* 모달 3: Mixdog 스타일 에이전트 편집 / 새 에이전트 모달 */}
      <AdaptiveModalSheet
        visible={agentModalMode !== null}
        header={agentSheetHeader}
        onClose={closeAgentModal}
        desktopMaxWidth={560}
        testID="engine-agent-edit-modal"
      >
        <View style={layout.modalBody}>
          {agentModalMode === "create" && (
            <View style={layout.fieldBlock}>
              <Text style={settingsStyles.rowTitle}>ID (선택)</Text>
              <Text style={settingsStyles.rowHint}>
                비워두면 이름에서 자동 생성됩니다. (예: rule-writer)
              </Text>
              <AdaptiveTextInput
                accessibilityLabel="새 에이전트 ID"
                initialValue={newAgentId}
                resetKey={agentRevision}
                onChangeText={setNewAgentId}
                placeholder="rule-writer"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                style={[settingsStyles.rowTitle, inputStyle]}
              />
            </View>
          )}

          {/* 이름 */}
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>이름</Text>
            <Text style={settingsStyles.rowHint}>에이전트 목록과 위임 메뉴에 표시됩니다.</Text>
            <AdaptiveTextInput
              accessibilityLabel="에이전트 이름"
              initialValue={agentName}
              resetKey={agentRevision}
              onChangeText={setAgentName}
              placeholder="Rule Writer"
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle]}
            />
          </View>

          {/* 사용 조건 */}
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>사용 조건</Text>
            <Text style={settingsStyles.rowHint}>
              Mixdog이 이 에이전트에 작업을 위임해야 하는 경우입니다.
            </Text>
            <AdaptiveTextInput
              accessibilityLabel="에이전트 설명"
              initialValue={agentDesc}
              resetKey={agentRevision}
              onChangeText={setAgentDesc}
              placeholder="Use when writing or updating rules, prompts, or instructions"
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle]}
            />
          </View>

          {/* 모델 (체인 + 폴백 추가) */}
          <View style={layout.fieldBlock}>
            <View style={layout.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={settingsStyles.rowTitle}>모델</Text>
                <Text style={settingsStyles.rowHint}>
                  첫 번째 모델을 먼저 사용합니다. 실패하면 다음 모델을 사용합니다.
                </Text>
              </View>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                accessibilityLabel="폴백 모델 추가"
                onPress={addFallbackModel}
              >
                +
              </Button>
            </View>
            <View style={layout.modelChainCard}>
              {/* 1순위 모델 행 */}
              <View style={[layout.modelChainRow, settingsStyles.rowBorder]}>
                <Select
                  title="모델 선택"
                  disabled={disabled}
                  value={`${agentProvider}/${agentModel}`}
                  options={modelOptions}
                  onChange={handleSelectAgentModel}
                />
                <Select
                  title="추론 수준"
                  disabled={disabled}
                  value={agentAutoEffort ? "auto" : agentEffort || "medium"}
                  options={agentEffortOptions}
                  onChange={handleSelectAgentEffort}
                />
              </View>
              {/* 폴백 모델 행 목록 */}
              {agentFallbacks.map((fb, idx) => (
                <View
                  key={`${fb.provider}-${fb.model}-${idx}`}
                  style={[layout.modelChainRow, settingsStyles.rowBorder]}
                >
                  <Select
                    title={`폴백 모델 ${idx + 1}`}
                    disabled={disabled}
                    value={`${fb.provider}/${fb.model}`}
                    options={modelOptions}
                    onChange={(val) => updateFallbackModel(idx, val)}
                  />
                  <Select
                    title={`폴백 추론 수준 ${idx + 1}`}
                    disabled={disabled}
                    value={fb.effort || "medium"}
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "xhigh", label: "XHigh" },
                    ]}
                    onChange={(eff) => updateFallbackEffort(idx, eff)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    accessibilityLabel={`폴백 모델 ${idx + 1} 삭제`}
                    onPress={() => removeFallbackModel(idx)}
                  >
                    ×
                  </Button>
                </View>
              ))}
            </View>
            {currentAgentModelMeta?.fastCapable && (
              <SettingRow title="Fast 모드" hint="빠른 응답 우선">
                <Switch
                  accessibilityLabel="Fast"
                  disabled={disabled}
                  value={agentFast}
                  onValueChange={setAgentFast}
                />
              </SettingRow>
            )}
          </View>

          {/* AGENT.md 본문 */}
          <View style={layout.fieldBlock}>
            <Text style={settingsStyles.rowTitle}>AGENT.md</Text>
            <Text style={settingsStyles.rowHint}>이 에이전트의 동작을 정의하는 지침입니다.</Text>
            <AdaptiveTextInput
              accessibilityLabel="에이전트 프롬프트 본문"
              initialValue={agentBody}
              resetKey={agentRevision}
              onChangeText={setAgentBody}
              placeholder="이 에이전트의 시스템 프롬프트 지침을 입력하세요."
              multiline
              editable={!disabled}
              style={[settingsStyles.rowTitle, inputStyle, layout.bodyInput]}
            />
          </View>

          {/* 하단 버튼 (삭제 / 취소 / 저장) */}
          <View style={layout.modalFooter}>
            <View>
              {agentModalMode === "edit" &&
                (editingAgentTarget?.custom ||
                  editingAgentTarget?.userOverride ||
                  editingAgentId === "rule-writer") && (
                  <Button size="sm" variant="ghost" disabled={disabled} onPress={deleteAgentModal}>
                    삭제
                  </Button>
                )}
            </View>
            <View style={layout.formActions}>
              <Button size="sm" variant="ghost" onPress={closeAgentModal}>
                취소
              </Button>
              <Button
                size="sm"
                disabled={
                  disabled ||
                  (agentModalMode === "create" && !agentName.trim() && !newAgentId.trim())
                }
                onPress={saveAgentModal}
              >
                저장
              </Button>
            </View>
          </View>
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

// 열린 세션별 컨텍스트 사용 토큰 표시 (값 없음 -> 확인 대기)
function formatUsedTokens(usedTokens: number | undefined) {
  return usedTokens === undefined ? "확인 대기" : `${Math.round(usedTokens).toLocaleString()} 토큰`;
}

// 열린 엔진 세션의 컨텍스트 사용량 목록
function SessionUsage({ sessions }: { sessions: EngineSnapshot["sessions"] }) {
  return (
    <SettingsSection title="열린 세션 컨텍스트 사용량">
      <View style={settingsStyles.card}>
        {sessions.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>현재 메모리에 열린 엔진 세션이 없어요.</Text>
          </View>
        ) : (
          sessions.map((session) => (
            <SettingRow key={session.id} title={session.model || "열린 세션"} hint={session.id}>
              <Text style={settingsStyles.rowTitle}>
                {formatUsedTokens(session.context?.usedTokens)}
              </Text>
            </SettingRow>
          ))
        )}
      </View>
    </SettingsSection>
  );
}

// 토큰 절감 설정 (자동 압축·유휴 세션 비우기·세션 리캡) 즉시 저장
function TokensSection({ snapshot, disabled, request }: SectionProps) {
  const send = useCallback(
    (command: EngineCommand) => {
      void request(command);
    },
    [request],
  );
  const setContextPercent = useCallback(
    (value: string) => send({ action: "main", route: { contextPercent: Number(value) } }),
    [send],
  );
  const setCompaction = useCallback(
    (enabled: boolean) => send({ action: "compaction", enabled }),
    [send],
  );
  const setOnModelChange = useCallback(
    (onModelChange: boolean) => send({ action: "compaction", onModelChange }),
    [send],
  );
  const setBuffer = useCallback(
    (value: string) => send({ action: "compaction", mainBufferPercent: Number(value) }),
    [send],
  );
  const setBufferTokens = useCallback(
    (value: string) => {
      const parsed = Number(value);
      send({ action: "compaction", mainBufferTokens: parsed > 0 ? parsed : 0 });
    },
    [send],
  );
  const setSummaryModel = useCallback(
    (value: string) => send({ action: "compaction", summaryModel: value || "" }),
    [send],
  );
  const setMemoryTimeout = useCallback(
    (value: string) => send({ action: "compaction", memoryTimeoutMs: Number(value) }),
    [send],
  );
  const setAutoClear = useCallback(
    (enabled: boolean) => send({ action: "autoClear", enabled }),
    [send],
  );
  const setIdle = useCallback(
    (value: string) => send({ action: "autoClear", idleMs: Number(value) }),
    [send],
  );
  const setMinContext = useCallback(
    (value: string) => send({ action: "autoClear", minContextPercent: Number(value) }),
    [send],
  );
  const resetAutoClear = useCallback(() => send({ action: "autoClear", reset: true }), [send]);
  const setRecap = useCallback((recap: boolean) => send({ action: "features", recap }), [send]);
  const autoClear = snapshot.autoClear;
  const summaryModelOptions = [
    { value: "", label: "자동 (현재 세션 모델)" },
    ...snapshot.models.map((item) => ({
      value: `${item.provider}/${item.id}`,
      label: `${item.label} · ${item.provider}`,
    })),
  ];

  return (
    <>
      <SettingsSection title="Mixdog 토큰 절감 기술">
        <View style={settingsStyles.card}>
          <SettingRow
            title="메인 컨텍스트 한도 비율"
            hint="모델 최대 컨텍스트 중 사용할 상한 비율을 제한해 과도한 과금 방지"
          >
            <Select
              title="메인 컨텍스트 한도 비율"
              disabled={disabled}
              value={String(snapshot.route.contextPercent ?? 100)}
              options={contextPercentOptions}
              onChange={setContextPercent}
            />
          </SettingRow>
          <SettingRow
            title="자동 컨텍스트 압축"
            hint="대화가 길어지면 핵심 맥락만 요약해 입력 토큰을 대폭 절감"
          >
            <Switch
              accessibilityLabel="자동 압축"
              disabled={disabled}
              value={snapshot.compaction.auto}
              onValueChange={setCompaction}
            />
          </SettingRow>
          <SettingRow
            title="모델 변경 시 자동 압축"
            hint="대화 중 모델을 바꿀 때 이전 맥락을 정리해 토큰 낭비 방지"
          >
            <Switch
              accessibilityLabel="모델 변경 시 자동 압축"
              disabled={disabled}
              value={snapshot.compaction.onModelChange ?? true}
              onValueChange={setOnModelChange}
            />
          </SettingRow>
          <SettingRow title="압축 여유 버퍼" hint="컨텍스트 한도 대비 남길 여유 공간 비율">
            <Select
              title="압축 여유 버퍼"
              disabled={disabled}
              value={String(snapshot.compaction.mainBufferPercent ?? 0.2)}
              options={bufferOptions}
              onChange={setBuffer}
            />
          </SettingRow>
          <SettingRow
            title="압축 여유 토큰 (절대값)"
            hint="비율 대신 고정 토큰 수로 여유 버퍼 지정"
          >
            <Select
              title="압축 여유 토큰"
              disabled={disabled}
              value={String(snapshot.compaction.mainBufferTokens ?? 0)}
              options={bufferTokenOptions}
              onChange={setBufferTokens}
            />
          </SettingRow>
          <SettingRow title="압축 요약 전용 모델" hint="컨텍스트 요약 시 사용할 경량 모델 지정">
            <Select
              title="압축 요약 전용 모델"
              disabled={disabled}
              value={snapshot.compaction.summaryModel ?? ""}
              options={summaryModelOptions}
              onChange={setSummaryModel}
            />
          </SettingRow>
          <SettingRow
            title="메모리 추출 제한 시간"
            hint="압축 시 장기 기억 추출에 허용할 최대 시간"
          >
            <Select
              title="메모리 추출 제한 시간"
              disabled={disabled}
              value={String(snapshot.compaction.memoryTimeoutMs ?? 30000)}
              options={memoryTimeoutOptions}
              onChange={setMemoryTimeout}
            />
          </SettingRow>
          <SettingRow
            title="세션 복귀 요약 (Recap)"
            hint="세션 재개 시 이전 작업 요약본을 자동으로 제공"
          >
            <Switch
              accessibilityLabel="세션 복귀 요약"
              disabled={disabled}
              value={snapshot.recap ?? true}
              onValueChange={setRecap}
            />
          </SettingRow>
        </View>
      </SettingsSection>

      <SettingsSection title="유휴 세션 자동 비우기 (Auto-Clear)">
        <View style={settingsStyles.card}>
          <SettingRow
            title="유휴 컨텍스트 자동 초기화"
            hint="자리를 비운 뒤 복귀할 때 누적된 무거운 컨텍스트를 자동 정리"
          >
            <Switch
              accessibilityLabel="유휴 컨텍스트 자동 초기화"
              disabled={disabled}
              value={autoClear?.enabled ?? false}
              onValueChange={setAutoClear}
            />
          </SettingRow>
          <SettingRow title="유휴 기준 시간" hint="마지막 대화 후 경과 시간">
            <Select
              title="유휴 기준 시간"
              disabled={disabled}
              value={String(autoClear?.idleMs ?? 3600000)}
              options={idleOptions}
              onChange={setIdle}
            />
          </SettingRow>
          <SettingRow title="최소 컨텍스트 점유율" hint="이 비율 이상 찬 세션만 자동 초기화">
            <Select
              title="최소 컨텍스트 점유율"
              disabled={disabled}
              value={String(autoClear?.minContextPercent ?? 50)}
              options={minContextOptions}
              onChange={setMinContext}
            />
          </SettingRow>
          <SettingRow
            title="공급자 기본값 복원"
            hint="사용자 지정 유휴 기준을 초기화하고 공급자별 최적 기본값으로 되돌려요"
          >
            <Button size="sm" variant="ghost" disabled={disabled} onPress={resetAutoClear}>
              기본값 복원
            </Button>
          </SettingRow>
        </View>
      </SettingsSection>

      <SessionUsage sessions={snapshot.sessions} />
    </>
  );
}

// 선택한 구역의 설정 본문만 렌더링한다.
function SectionBody({
  section,
  ...props
}: SectionProps & { section: Exclude<EngineSection, "accounts"> }) {
  switch (section) {
    case "workflow":
    case "agents":
      return <WorkflowSection {...props} />;
    case "tokens":
      return <TokensSection {...props} />;
    case "instructions":
      return <InstructionsSection {...props} />;
    case "tools":
      return <ToolsSection {...props} />;
    case "skills":
      return <SkillsSection {...props} />;
  }
}

// 선택한 호스트의 Mixdog 엔진 설정 중 해당 구역의 컨트롤만 지연 없이 제어한다 (기본 모델은 채팅에서 선택).
export function AiEnginePage({ serverId, section }: { serverId: string; section: EngineSection }) {
  const { snapshot, busy, connected, message, error, request } = useAiEngineSettings(serverId);
  const disabled = !connected;
  const refresh = useCallback(() => {
    void request({ action: "read", refresh: true });
  }, [request]);

  if (section === "accounts")
    return (
      <View style={layout.page}>
        {!connected && (
          <Text style={settingsStyles.rowError}>호스트에 연결한 뒤 설정할 수 있어요.</Text>
        )}
        <EngineAccounts key={serverId} serverId={serverId} onConnected={refresh} />
      </View>
    );

  return (
    <View style={layout.page}>
      <View style={layout.toolbar}>
        <Button variant="ghost" size="sm" disabled={disabled || busy} onPress={refresh}>
          {busy ? "동기화 중…" : "새로고침"}
        </Button>
      </View>

      {!connected && (
        <Text style={settingsStyles.rowError}>호스트에 연결한 뒤 설정할 수 있어요.</Text>
      )}
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={settingsStyles.rowError}>
          {error}
        </Text>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={settingsStyles.rowHint}>
          {message}
        </Text>
      )}
      {snapshot && (
        <SectionBody
          section={section}
          snapshot={snapshot}
          disabled={disabled}
          busy={busy}
          request={request}
        />
      )}
    </View>
  );
}
