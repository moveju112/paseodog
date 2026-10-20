import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";

const providers = [
  { id: "anthropic-oauth", name: "Claude 구독" },
  { id: "openai-oauth", name: "Codex 구독" },
] as const;
type Provider = (typeof providers)[number]["id"];

const defaultApiProviders = [
  { id: "anthropic", label: "Anthropic (Claude API)", configured: false },
  { id: "openai", label: "OpenAI API", configured: false },
  { id: "gemini", label: "Google Gemini API", configured: false },
  { id: "openrouter", label: "OpenRouter API", configured: false },
  { id: "deepseek", label: "DeepSeek API", configured: false },
  { id: "xai", label: "xAI (Grok) API", configured: false },
  { id: "groq", label: "Groq API", configured: false },
  { id: "mistral", label: "Mistral API", configured: false },
] as const;

const oauthAccountSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  email: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  authenticated: z.boolean().optional(),
  selected: z.boolean().optional(),
  usage: z.record(z.string(), z.unknown()).nullable().optional(),
});
const apiProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  configured: z.boolean(),
});
const resultSchema = z.object({
  id: z.string().optional(),
  state: z.string(),
  connected: z.boolean().optional(),
  url: z.string().url().optional(),
  userCode: z.string().nullable().optional(),
  acceptsCode: z.boolean().optional(),
  selectedId: z.string().nullable().optional(),
  accounts: z.array(oauthAccountSchema).optional(),
  apiProviders: z.array(apiProviderSchema).optional(),
});
type OAuthAccountItem = z.infer<typeof oauthAccountSchema>;
type ApiProviderItem = z.infer<typeof apiProviderSchema>;
type AuthResult = z.infer<typeof resultSchema>;
type Flow = AuthResult & { provider: Provider };
type AuthAction = "start" | "status" | "complete" | "cancel";

const statusMessages = new Map([
  ["pending", "브라우저에서 로그인을 완료해 주세요."],
  ["idle", "로그인이 만료됐어요. 다시 시작해 주세요."],
]);
const statusFailureMessage = "로그인 완료를 확인하지 못했어요. 새 로그인으로 다시 시도해 주세요.";
const codeInputStyle = {
  borderWidth: 1,
  borderColor: "#888",
  borderRadius: 8,
  padding: 12,
} as const;
const sheetBodyStyle = { gap: 12 } as const;
const inlineActionsStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;

// 계정 연결 상태 문구 (확인 전 -> 확인 중)
function accountStatusLabel(accountConnected: boolean | undefined) {
  if (accountConnected === undefined) return "확인 중";
  return accountConnected ? "연결됨" : "연결 안 됨";
}

// OAuth 계정 사용량 요약 문자열 생성 (usage 객체 -> 한 줄 요약)
function formatUsageSummary(usage: Record<string, unknown> | null | undefined) {
  if (!usage) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number") parts.push(`${key}: ${value}%`);
    else if (typeof value === "string" && value) parts.push(`${key}: ${value}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// 공급자 한 줄 (연결 상태 + 로그인 창 열기 + 다중 계정 풀 관리)
function AccountRow({
  id,
  name,
  accountConnected,
  pool,
  disabled,
  onOpen,
  onSelectAccount,
  onRefreshUsage,
  onLogout,
}: {
  id: Provider;
  name: string;
  accountConnected: boolean | undefined;
  pool: OAuthAccountItem[];
  disabled: boolean;
  onOpen: (provider: Provider) => void;
  onSelectAccount: (provider: Provider, accountId: string) => void;
  onRefreshUsage: (provider: Provider) => void;
  onLogout: (provider: Provider, accountId?: string) => void;
}) {
  const handleOpen = useCallback(() => onOpen(id), [id, onOpen]);
  const handleRefresh = useCallback(() => onRefreshUsage(id), [id, onRefreshUsage]);
  return (
    <View style={{ gap: 8 }}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{name}</Text>
          <Text style={settingsStyles.rowHint}>{accountStatusLabel(accountConnected)}</Text>
        </View>
        <View style={inlineActionsStyle}>
          {accountConnected && (
            <Button size="sm" variant="ghost" disabled={disabled} onPress={handleRefresh}>
              사용량 갱신
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={disabled} onPress={handleOpen}>
            {accountConnected ? "계정 추가" : "로그인"}
          </Button>
        </View>
      </View>
      {pool.map((acct) => {
        const usageText = formatUsageSummary(acct.usage);
        return (
          <View key={acct.id} style={[settingsStyles.row, { paddingLeft: 12 }]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {acct.email || acct.label || acct.id}
                {acct.plan ? ` (${acct.plan})` : ""}
                {acct.selected ? " · 활성" : ""}
              </Text>
              {usageText && <Text style={settingsStyles.rowHint}>{usageText}</Text>}
            </View>
            <View style={inlineActionsStyle}>
              {!acct.selected && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onPress={() => onSelectAccount(id, acct.id)}
                >
                  선택
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onPress={() => onLogout(id, acct.id)}
              >
                로그아웃
              </Button>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// 진행 중인 브라우저 로그인 (페이지 다시 열기·기기 코드·일회성 코드 제출·완료 확인·취소)
function LoginFlowPanel({
  flow,
  code,
  codeRevision,
  busy,
  onCodeChange,
  onReopen,
  onSubmit,
  onCheck,
  onCancel,
}: {
  flow: Flow;
  code: string;
  codeRevision: number;
  busy: boolean;
  onCodeChange: (code: string) => void;
  onReopen: () => void;
  onSubmit: () => void;
  onCheck: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={sheetBodyStyle}>
      <Text style={settingsStyles.rowTitle}>브라우저 로그인 진행 중</Text>
      {flow.url && (
        <Button variant="outline" onPress={onReopen}>
          로그인 페이지 다시 열기
        </Button>
      )}
      {!!flow.userCode && (
        <Text selectable style={settingsStyles.rowTitle}>
          인증 코드: {flow.userCode}
        </Text>
      )}
      {flow.acceptsCode && (
        <>
          <Text style={settingsStyles.rowHint}>
            공급자가 인증 코드 또는 최종 리디렉션 주소를 제공하면 아래에 붙여넣으세요. 채팅에는
            보내지 마세요.
          </Text>
          <AdaptiveTextInput
            accessibilityLabel="일회성 로그인 코드"
            initialValue={code}
            resetKey={codeRevision}
            onChangeText={onCodeChange}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={[settingsStyles.rowTitle, codeInputStyle]}
          />
          <Button disabled={busy || !code.trim()} onPress={onSubmit}>
            코드 제출
          </Button>
        </>
      )}
      <Button disabled={busy} onPress={onCheck}>
        로그인 완료 확인
      </Button>
      <Button variant="ghost" disabled={busy} onPress={onCancel}>
        로그인 취소
      </Button>
    </View>
  );
}

// 브라우저 로그인과 일회성 코드 입력을 연결하며 토큰은 앱에 저장하지 않는다.
export function EngineAccounts({
  serverId,
  onConnected,
}: {
  serverId: string;
  onConnected: () => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [accounts, setAccounts] = useState<Partial<Record<Provider, boolean>>>({});
  const [accountPools, setAccountPools] = useState<Partial<Record<Provider, OAuthAccountItem[]>>>({});
  const [apiProviders, setApiProviders] = useState<ApiProviderItem[]>([...defaultApiProviders]);
  const [apiModalProvider, setApiModalProvider] = useState<ApiProviderItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyRevision, setApiKeyRevision] = useState(0);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [code, setCode] = useState("");
  const [codeRevision, setCodeRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [modalProvider, setModalProvider] = useState<Provider | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const modalOpen = useRef(false);
  const flowId = flow?.id;
  const flowProvider = flow?.provider;
  const flowUrl = flow?.url;

  // 공급자 응답에서 다중 계정 목록과 API 키 공급자 상태를 반영한다.
  const syncProviderSnapshot = useCallback((provider: Provider, result: AuthResult) => {
    setAccounts((current) => ({ ...current, [provider]: result.connected === true }));
    if (result.accounts) {
      setAccountPools((current) => ({ ...current, [provider]: result.accounts }));
    }
    if (result.apiProviders) {
      setApiProviders(result.apiProviders);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (client && connected)
      void Promise.all(
        providers.map(async ({ id }) => {
          try {
            const result = resultSchema.parse(
              await client.invokePluginRpc("paseodog-provider", "engine-auth", {
                action: "status",
                provider: id,
              }),
            );
            if (mounted.current) syncProviderSnapshot(id, result);
          } catch {
            if (mounted.current)
              setMessage("계정 상태를 불러오지 못했어요. 서버의 AI 엔진 업데이트를 확인해 주세요.");
          }
        }),
      );
    return () => {
      mounted.current = false;
    };
  }, [client, connected, syncProviderSnapshot]);

  // 입력한 일회성 코드를 상태와 입력창에서 모두 지운다.
  const clearCode = useCallback(() => {
    setCode("");
    setCodeRevision((current) => current + 1);
  }, []);

  // 진행 중인 로그인 요청을 서버에서 취소하고 실패는 화면에 알린다.
  const cancelFlow = useCallback(
    async (provider: Provider, id: string) => {
      if (!client) return;
      try {
        await client.invokePluginRpc("paseodog-provider", "engine-auth", {
          action: "cancel",
          provider,
          id,
        });
        if (mounted.current) setMessage("로그인을 취소했어요.");
      } catch {
        if (mounted.current)
          setMessage("로그인 취소를 확인하지 못했어요. 다시 로그인하면 새 요청으로 시작돼요.");
      }
    },
    [client],
  );

  // 인증 응답을 화면 상태에 반영한다 (시작·취소·완료·상태 확인).
  const applyResult = useCallback(
    async (provider: Provider, action: AuthAction, result: AuthResult) => {
      if (action === "start" && !modalOpen.current) {
        // 응답 전에 창을 닫았다면 늦게 생성된 로그인 요청을 서버에서 취소한다.
        if (result.id) await cancelFlow(provider, result.id);
        return;
      }
      if (action === "start") {
        clearCode();
        setFlow({ ...result, provider });
        if (result.url) await openExternalUrl(result.url);
        return;
      }
      if (action === "cancel") {
        setFlow(null);
        clearCode();
        setMessage("로그인을 취소했어요.");
        return;
      }
      if (result.state === "completed") {
        setFlow(null);
        clearCode();
        modalOpen.current = false;
        setModalProvider(null);
        syncProviderSnapshot(provider, { ...result, connected: true });
        setMessage("연결했어요. 모델 목록을 새로고침합니다.");
        onConnected();
        return;
      }
      if (result.state !== "pending") {
        setFlow(null);
        clearCode();
      }
      setMessage(statusMessages.get(result.state) ?? statusFailureMessage);
    },
    [cancelFlow, clearCode, onConnected, syncProviderSnapshot],
  );

  // 사용자 조작만 인증 요청으로 보내고 공급자 오류에 포함될 수 있는 비밀값은 표시하지 않는다.
  const perform = useCallback(
    async (provider: Provider, action: AuthAction) => {
      if (!client || !connected || locked.current) return;
      locked.current = true;
      setBusy(true);
      setMessage("");
      const submittedCode = code;
      if (action === "complete") clearCode();
      try {
        const result = resultSchema.parse(
          await client.invokePluginRpc("paseodog-provider", "engine-auth", {
            action,
            provider,
            ...(flowId ? { id: flowId } : {}),
            ...(action === "complete" ? { code: submittedCode } : {}),
          }),
        );
        if (mounted.current) await applyResult(provider, action, result);
      } catch {
        if (mounted.current) setMessage("로그인 요청을 완료하지 못했어요. 다시 시도해 주세요.");
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [applyResult, clearCode, client, code, connected, flowId],
  );

  // 다중 OAuth 계정 전환 (활성 계정 변경 -> 모델 목록 새로고침)
  const handleSelectAccount = useCallback(
    async (provider: Provider, accountId: string) => {
      if (!client || !connected || locked.current) return;
      locked.current = true;
      setBusy(true);
      try {
        const result = resultSchema.parse(
          await client.invokePluginRpc("paseodog-provider", "engine-auth", {
            action: "selectAccount",
            provider,
            accountId,
          }),
        );
        if (mounted.current) {
          syncProviderSnapshot(provider, result);
          setMessage("활성 계정을 변경했어요.");
          onConnected();
        }
      } catch {
        if (mounted.current) setMessage("계정을 전환하지 못했어요.");
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [client, connected, onConnected, syncProviderSnapshot],
  );

  // OAuth 구독 사용량 새로고침 (서버 조회 -> 계정 풀 갱신)
  const handleRefreshUsage = useCallback(
    async (provider: Provider) => {
      if (!client || !connected || locked.current) return;
      locked.current = true;
      setBusy(true);
      try {
        const result = resultSchema.parse(
          await client.invokePluginRpc("paseodog-provider", "engine-auth", {
            action: "refreshUsage",
            provider,
          }),
        );
        if (mounted.current) {
          syncProviderSnapshot(provider, result);
          setMessage("사용량 정보를 갱신했어요.");
        }
      } catch {
        if (mounted.current) setMessage("사용량 정보를 불러오지 못했어요.");
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [client, connected, syncProviderSnapshot],
  );

  // OAuth 계정 로그아웃 (단일 계정 또는 공급자 전체 해제)
  const handleLogout = useCallback(
    async (provider: Provider, accountId?: string) => {
      if (!client || !connected || locked.current) return;
      locked.current = true;
      setBusy(true);
      try {
        const result = resultSchema.parse(
          await client.invokePluginRpc("paseodog-provider", "engine-auth", {
            action: "logout",
            provider,
            ...(accountId ? { accountId } : {}),
          }),
        );
        if (mounted.current) {
          syncProviderSnapshot(provider, result);
          setMessage("계정 연결을 해제했어요.");
          onConnected();
        }
      } catch {
        if (mounted.current) setMessage("로그아웃을 완료하지 못했어요.");
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [client, connected, onConnected, syncProviderSnapshot],
  );

  // API 키 저장 또는 삭제 (서버 저장 -> 모델 카탈로그 갱신)
  const saveApiKey = useCallback(
    async (providerId: string, apiKeyValue: string) => {
      if (!client || !connected || locked.current) return;
      locked.current = true;
      setBusy(true);
      try {
        const result = resultSchema.parse(
          await client.invokePluginRpc("paseodog-provider", "engine-auth", {
            action: "saveApiKey",
            provider: providerId,
            apiKey: apiKeyValue,
          }),
        );
        if (mounted.current) {
          if (result.apiProviders) setApiProviders(result.apiProviders);
          else {
            setApiProviders((current) =>
              current.map((item) =>
                item.id === providerId
                  ? { ...item, configured: Boolean(apiKeyValue.trim()) }
                  : item,
              ),
            );
          }
          setApiModalProvider(null);
          setApiKeyInput("");
          setApiKeyRevision((current) => current + 1);
          setMessage(apiKeyValue.trim() ? "API 키를 저장했어요." : "API 키를 삭제했어요.");
          onConnected();
        }
      } catch {
        if (mounted.current) setMessage("API 키를 저장하지 못했어요.");
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [client, connected, onConnected],
  );

  // 로그인 창 열기 (자동으로 로그인을 시작하지 않음)
  const openModal = useCallback((provider: Provider) => {
    modalOpen.current = true;
    setMessage("");
    setModalProvider(provider);
  }, []);

  // 로그인 창 닫기 (닫기·뒤로가기 -> 입력 코드 폐기 + 진행 중 요청 취소)
  const closeModal = useCallback(() => {
    modalOpen.current = false;
    setModalProvider(null);
    setFlow(null);
    clearCode();
    if (flowId && flowProvider) void cancelFlow(flowProvider, flowId);
  }, [cancelFlow, clearCode, flowId, flowProvider]);

  // API 키 설정 창 열기/닫기
  const openApiModal = useCallback((item: ApiProviderItem) => {
    setApiKeyInput("");
    setApiKeyRevision((current) => current + 1);
    setApiModalProvider(item);
  }, []);
  const closeApiModal = useCallback(() => {
    setApiModalProvider(null);
    setApiKeyInput("");
    setApiKeyRevision((current) => current + 1);
  }, []);

  // 창 안의 로그인 조작 (시작·코드 제출·완료 확인·취소·페이지 다시 열기)
  const startLogin = useCallback(() => {
    if (modalProvider) void perform(modalProvider, "start");
  }, [modalProvider, perform]);
  const submitCode = useCallback(() => {
    if (flowProvider) void perform(flowProvider, "complete");
  }, [flowProvider, perform]);
  const checkLogin = useCallback(() => {
    if (flowProvider) void perform(flowProvider, "status");
  }, [flowProvider, perform]);
  const cancelLogin = useCallback(() => {
    if (flowProvider) void perform(flowProvider, "cancel");
  }, [flowProvider, perform]);
  const reopenLogin = useCallback(() => {
    if (flowUrl) void openExternalUrl(flowUrl).catch(() => setMessage("브라우저를 열지 못했어요."));
  }, [flowUrl]);

  const modalName = providers.find(({ id }) => id === modalProvider)?.name ?? "";
  const sheetHeader = useMemo(() => ({ title: `${modalName} 로그인` }), [modalName]);
  const apiSheetHeader = useMemo(
    () => ({ title: `${apiModalProvider?.label ?? "API"} 키 설정` }),
    [apiModalProvider],
  );

  return (
    <SettingsSection title="계정 연결">
      <Text style={settingsStyles.rowHint}>
        공식 로그인 페이지에서 직접 로그인하세요. 인증정보는 이 호스트에 보관되며 기존 계정은
        삭제하지 않아요.
      </Text>
      <View style={settingsStyles.card}>
        {providers.map(({ id, name }) => (
          <AccountRow
            key={id}
            id={id}
            name={name}
            accountConnected={accounts[id]}
            pool={accountPools[id] ?? []}
            disabled={busy || !connected}
            onOpen={openModal}
            onSelectAccount={handleSelectAccount}
            onRefreshUsage={handleRefreshUsage}
            onLogout={handleLogout}
          />
        ))}
      </View>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>API 키 공급자</Text>
            <Text style={settingsStyles.rowHint}>
              Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, xAI, Groq, Mistral API 키를 호스트에
              등록해 해당 모델을 사용할 수 있어요.
            </Text>
          </View>
        </View>
        {apiProviders.map((item) => (
          <View key={item.id} style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{item.label}</Text>
              <Text style={settingsStyles.rowHint}>
                {item.configured ? "키 등록됨" : "미설정"}
              </Text>
            </View>
            <View style={inlineActionsStyle}>
              {item.configured && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !connected}
                  onPress={() => void saveApiKey(item.id, "")}
                >
                  키 삭제
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !connected}
                onPress={() => openApiModal(item)}
              >
                {item.configured ? "키 변경" : "키 설정"}
              </Button>
            </View>
          </View>
        ))}
      </View>
      {!modalProvider && !apiModalProvider && (
        <Text accessibilityLiveRegion="polite" style={settingsStyles.rowHint}>
          {message}
        </Text>
      )}
      <AdaptiveModalSheet
        visible={modalProvider !== null}
        header={sheetHeader}
        onClose={closeModal}
        desktopMaxWidth={480}
        testID="engine-account-login-modal"
      >
        <View style={sheetBodyStyle}>
          {modalProvider && !flow && (
            <Button disabled={busy || !connected} onPress={startLogin}>
              브라우저 로그인 시작
            </Button>
          )}
          {flow && (
            <LoginFlowPanel
              flow={flow}
              code={code}
              codeRevision={codeRevision}
              busy={busy}
              onCodeChange={setCode}
              onReopen={reopenLogin}
              onSubmit={submitCode}
              onCheck={checkLogin}
              onCancel={cancelLogin}
            />
          )}
          <Text accessibilityLiveRegion="polite" style={settingsStyles.rowHint}>
            {message}
          </Text>
          <Button variant="ghost" onPress={closeModal}>
            닫기
          </Button>
        </View>
      </AdaptiveModalSheet>
      <AdaptiveModalSheet
        visible={apiModalProvider !== null}
        header={apiSheetHeader}
        onClose={closeApiModal}
        desktopMaxWidth={480}
        testID="engine-api-key-modal"
      >
        <View style={sheetBodyStyle}>
          <Text style={settingsStyles.rowHint}>
            {apiModalProvider?.label} 키를 입력하세요. 입력한 키는 호스트 인증 저장소에 안전하게
            보관돼요.
          </Text>
          <AdaptiveTextInput
            accessibilityLabel="API 키 입력"
            initialValue={apiKeyInput}
            resetKey={apiKeyRevision}
            onChangeText={setApiKeyInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={[settingsStyles.rowTitle, codeInputStyle]}
          />
          <Button
            disabled={busy || !apiKeyInput.trim() || !apiModalProvider}
            onPress={() => apiModalProvider && void saveApiKey(apiModalProvider.id, apiKeyInput)}
          >
            API 키 저장
          </Button>
          <Button variant="ghost" onPress={closeApiModal}>
            닫기
          </Button>
        </View>
      </AdaptiveModalSheet>
    </SettingsSection>
  );
}
