import type { StreamLayoutItem } from "./layout";
import type { WorkRecordItem } from "@/types/stream";
import type { ReactNode, ComponentType, ComponentProps } from "react";

interface ContinueClient {
  sendAgentMessage(
    agentId: string,
    text: string,
    options: { messageId: string; images: never[]; attachments: never[] },
  ): Promise<unknown>;
}

interface RendererDependencies {
  React: typeof import("react");
  View: ComponentType<ComponentProps<typeof import("react-native").View>>;
  Text: ComponentType<ComponentProps<typeof import("react-native").Text>>;
  Image: ComponentType<ComponentProps<typeof import("react-native").Image>>;
  Pressable: ComponentType<ComponentProps<typeof import("react-native").Pressable>>;
  StyleSheet: typeof import("react-native-unistyles").StyleSheet;
  useTranslation: typeof import("react-i18next").useTranslation;
  useAssistantNickname: () => string;
  useAssistantIcon: () => string;
  useAssistantPhoto: () => string;
  /** 연결된 호스트 클라이언트 (서버 ID -> 클라이언트, 연결 전이면 null) */
  getClient: (serverId: string) => ContinueClient | null;
}

/** 이 렌더러가 그리는 대화의 세션 (이어서 진행 요청 대상) */
export interface WorkRecordSession {
  serverId: string;
  agentId: string;
}

// 원래 Markdown·도구 렌더러를 재사용하고 접기·답변 제목·끊김 후 이어서 진행만 표시 단계에 더한다.
export function createWorkRecordRenderer(deps: RendererDependencies) {
  // 웹 번들에도 함수 자체를 주입하므로 판별에 필요한 값은 이 함수 안에 둔다.
  // 엔진의 알려진 연결 오류만 허용한다. 인증·quota·정책 거절을 재시도로 바꾸지 않는다.
  const resumableErrors = new Set([
    "Provider connection closed",
    "Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.",
    "Cursor connection timed out",
    "Cursor request timed out",
    "Cursor stream ended before turnEnded",
    "Cursor stream closed before its end frame",
  ]);
  const resumableErrorPatterns = [
    /^(?:terminated|socket hang up|other side closed|connection error\.?|fetch failed|failed to fetch|couldn'?t fetch\.?|load failed|network error)$/i,
    /^(?:Connection to the provider was lost|Could not reach the provider|The provider did not respond in time|Provider is temporarily unavailable)(?: \([A-Z0-9_]+\))?\.$/,
    /^(?:OpenAI(?: OAuth)?|xAI) WS (?:closed before response\.completed|handshake closed before open) \(code=(?:1000|1001|1005|1006|1011|1012)(?:, reason=[^\r\n]*)?\)$/,
  ];
  const {
    React,
    View,
    Text,
    Image,
    Pressable,
    StyleSheet,
    useTranslation,
    useAssistantNickname,
    useAssistantIcon,
    useAssistantPhoto,
    getClient,
  } = deps;
  const copies: Record<
    string,
    {
      record: string;
      answer: string;
      progress: string;
      working: string;
      collapse: string;
      resume: string;
      resumeMessage: string;
    }
  > = {
    en: {
      record: "Reasoning & progress",
      answer: "Answer",
      progress: "Progress",
      working: "Working…",
      collapse: "Collapse",
      resume: "Continue",
      resumeMessage: "Continue",
    },
    ko: {
      record: "진행 기록",
      answer: "응답",
      progress: "진행 안내",
      working: "작업 진행 중…",
      collapse: "접기",
      resume: "이어서 진행하기",
      resumeMessage: "이어서 진행",
    },
    ja: {
      record: "思考・進捗",
      answer: "回答",
      progress: "進捗",
      working: "作業中…",
      collapse: "折りたたむ",
      resume: "続けて進める",
      resumeMessage: "続けて進めて",
    },
    zh: {
      record: "推理与进度",
      answer: "回答",
      progress: "进度",
      working: "处理中…",
      collapse: "收起",
      resume: "继续进行",
      resumeMessage: "继续",
    },
    fr: {
      record: "Réflexion et progression",
      answer: "Réponse",
      progress: "Progression",
      working: "En cours…",
      collapse: "Réduire",
      resume: "Continuer",
      resumeMessage: "Continue",
    },
    es: {
      record: "Razonamiento y progreso",
      answer: "Respuesta",
      progress: "Progreso",
      working: "En curso…",
      collapse: "Contraer",
      resume: "Continuar",
      resumeMessage: "Continúa",
    },
    pt: {
      record: "Raciocínio e progresso",
      answer: "Resposta",
      progress: "Progresso",
      working: "Em andamento…",
      collapse: "Recolher",
      resume: "Continuar",
      resumeMessage: "Continue",
    },
    ru: {
      record: "Рассуждения и ход работы",
      answer: "Ответ",
      progress: "Ход работы",
      working: "В работе…",
      collapse: "Свернуть",
      resume: "Продолжить",
      resumeMessage: "Продолжай",
    },
    ar: {
      record: "التفكير والتقدم",
      answer: "الإجابة",
      progress: "التقدم",
      working: "جارٍ العمل…",
      collapse: "طيّ",
      resume: "متابعة",
      resumeMessage: "تابع",
    },
  };
  const styles = StyleSheet.create((theme) => ({
    record: {
      uni__dependencies: [0],
      backgroundColor: theme.colorScheme === "light" ? "#ffffff" : theme.colors.surface1,
      borderColor: theme.colorScheme === "light" ? "#e0e7e1" : theme.colors.border,
      borderWidth: 1,
      borderRadius: 13,
      overflow: "hidden",
    },
    header: {
      uni__dependencies: [0],
      flexDirection: "row",
      alignItems: "center",
      padding: 15,
      gap: theme.spacing[2],
      backgroundColor: theme.colorScheme === "light" ? "#f7f9f5" : theme.colors.surface1,
    },
    title: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
      flex: 1,
    },
    count: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    preview: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      paddingHorizontal: 18,
      paddingBottom: 14,
      paddingTop: 10,
    },
    body: { uni__dependencies: [0], padding: 18, gap: 16 },
    entry: {
      uni__dependencies: [0],
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.border,
      paddingLeft: 16,
      marginLeft: 5,
    },
    entryDot: {
      uni__dependencies: [0],
      position: "absolute",
      left: -4,
      top: 4,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.colors.foregroundMuted,
    },
    active: {
      uni__dependencies: [0],
      color: theme.colorScheme === "light" ? "#47755a" : theme.colors.foreground,
      fontSize: theme.fontSize.sm,
    },
    footer: {
      uni__dependencies: [0],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[1],
      padding: 10,
      borderTopColor: theme.colors.border,
      borderTopWidth: 1,
    },
    label: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      marginBottom: theme.spacing[1],
    },
    answerContainer: { paddingLeft: { xs: 0, md: 40 } },
    answerHeader: {
      uni__dependencies: [0],
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginLeft: { xs: 0, md: -40 },
      marginBottom: 8,
    },
    avatar: {
      uni__dependencies: [0],
      width: 28,
      height: 28,
      borderRadius: 9,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colorScheme === "light" ? "#e7efe9" : theme.colors.surface1,
    },
    avatarText: {
      uni__dependencies: [0],
      color: theme.colorScheme === "light" ? "#3c6a50" : theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    answer: {
      uni__dependencies: [0],
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
      flexShrink: 1,
    },
    resume: {
      uni__dependencies: [0],
      alignSelf: "flex-start",
      marginTop: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[1],
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.accent,
    },
    resumeText: {
      uni__dependencies: [0],
      color: theme.colors.accentForeground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
  }));

  // 기존 앱 언어를 읽고 알 수 없는 로케일만 영어로 표시한다.
  function useCopy() {
    const { i18n } = useTranslation();
    const locale = (i18n.resolvedLanguage ?? i18n.language).split("-")[0]!;
    return copies[locale] ?? copies.en!;
  }

  // 기본 접힘을 유지하고 작업이 끝나면 펼쳐 두었던 진행 기록도 접는다. 펼친 기록은 맨 아래에서도 접을 수 있다.
  function WorkRecord({
    layout,
    render,
  }: {
    layout: StreamLayoutItem & { item: WorkRecordItem };
    render: (row: StreamLayoutItem) => ReactNode;
  }) {
    const copy = useCopy();
    const record = layout.item;
    const [expanded, setExpanded] = React.useState(false);
    React.useEffect(() => {
      if (!record.active) setExpanded(false);
    }, [record.active]);
    return React.createElement(
      View,
      { style: styles.record, testID: "assistant-work-record" },
      React.createElement(
        Pressable,
        {
          testID: "assistant-work-record-toggle",
          accessibilityRole: "button",
          accessibilityLabel: copy.record,
          accessibilityState: { expanded },
          onPress: () => setExpanded(!expanded),
        },
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(
            Text,
            { style: styles.count, accessible: false },
            expanded ? "⌄" : "›",
          ),
          React.createElement(Text, { style: styles.title }, copy.record),
          React.createElement(Text, { style: styles.count }, String(record.count)),
          record.active
            ? React.createElement(Text, { style: styles.active }, `● ${copy.working}`)
            : null,
        ),
        record.active && !expanded
          ? React.createElement(
              Text,
              { style: styles.preview, numberOfLines: 1 },
              record.preview || copy.working,
            )
          : null,
      ),
      expanded
        ? React.createElement(
            View,
            { style: styles.body },
            record.items.map((item, index) =>
              React.createElement(
                View,
                { key: item.id, style: styles.entry },
                React.createElement(View, { style: styles.entryDot, accessible: false }),
                item.kind === "assistant_message" && !item.blockIndex
                  ? React.createElement(
                      Text,
                      { style: styles.label },
                      item.assistantPhase === "final_answer" ? copy.answer : copy.progress,
                    )
                  : null,
                render({
                  ...layout,
                  item,
                  completedFooter: null,
                  phase: record.active ? "streaming" : "complete",
                  isLastInToolSequence: !["thought", "tool_call"].includes(
                    record.items[index + 1]?.kind ?? "",
                  ),
                }),
              ),
            ),
          )
        : null,
      expanded
        ? React.createElement(
            Pressable,
            {
              style: styles.footer,
              testID: "assistant-work-record-collapse",
              accessibilityRole: "button",
              accessibilityLabel: `${copy.record} ${copy.collapse}`,
              accessibilityState: { expanded },
              onPress: () => setExpanded(false),
            },
            React.createElement(Text, { style: styles.count, accessible: false }, "⌃"),
            React.createElement(Text, { style: styles.count }, copy.collapse),
          )
        : null,
    );
  }

  // 첫 답변 블록에 설정 닉네임·아바타를 달고 기존 Markdown 본문과 기능은 유지한다.
  function Answer({ children }: { children: ReactNode }) {
    const nickname = useAssistantNickname();
    const icon = useAssistantIcon();
    const photo = useAssistantPhoto();
    const [failedPhoto, setFailedPhoto] = React.useState<string | null>(null);
    return React.createElement(
      View,
      { testID: "assistant-answer", style: styles.answerContainer },
      React.createElement(
        View,
        { style: styles.answerHeader },
        React.createElement(
          View,
          { style: styles.avatar, accessible: false },
          photo && failedPhoto !== photo
            ? React.createElement(Image, {
                key: photo,
                source: { uri: photo },
                style: { width: 28, height: 28 },
                resizeMode: "cover",
                accessible: false,
                testID: "assistant-avatar-photo",
                onError: () => setFailedPhoto(photo),
              })
            : React.createElement(
                Text,
                { style: styles.avatarText, testID: "assistant-avatar-icon" },
                icon || Array.from(nickname)[0],
              ),
        ),
        React.createElement(
          Text,
          { style: styles.answer, accessibilityRole: "header", numberOfLines: 1 },
          nickname,
        ),
      ),
      children,
    );
  }

  // 복구 가능한 오류로 끝난 마지막 턴 아래 버튼. 원래 요청을 재전송하지 않는다.
  function ResumeAfterInterruption({ session }: { session: WorkRecordSession }) {
    const copy = useCopy();
    const [sending, setSending] = React.useState(false);
    const resume = () => {
      const client = getClient(session.serverId);
      if (sending || !client) return;
      setSending(true);
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      // 실패하면 다시 누를 수 있게만 되돌리고 자동 재전송하지 않는다.
      client
        .sendAgentMessage(session.agentId, copy.resumeMessage, {
          messageId,
          images: [],
          attachments: [],
        })
        .catch(() => setSending(false));
    };
    return React.createElement(
      Pressable,
      {
        style: styles.resume,
        testID: "assistant-resume-after-disconnect",
        accessibilityRole: "button",
        accessibilityLabel: copy.resume,
        accessibilityState: { disabled: sending },
        disabled: sending,
        onPress: resume,
      },
      React.createElement(Text, { style: styles.resumeText }, copy.resume),
    );
  }

  // 대화 맨 끝의 완료 턴만 허용하며, 진단 부록에 인용된 오류 문구는 판별에 쓰지 않는다.
  function endsWithResumableError(layout: StreamLayoutItem): boolean {
    if (
      layout.item.kind !== "assistant_message" ||
      layout.belowItem !== null ||
      layout.phase !== "complete"
    )
      return false;
    const text = layout.item.text.trim();
    const prefix = "[System Error] ";
    if (!text.startsWith(prefix)) return false;
    const message = text.slice(prefix.length).split("\n\n", 1)[0]!;
    return (
      resumableErrors.has(message) ||
      resumableErrorPatterns.some((pattern) => pattern.test(message))
    );
  }

  return (
    layout: StreamLayoutItem,
    render: (row: StreamLayoutItem) => ReactNode,
    session?: WorkRecordSession,
  ): ReactNode => {
    if (layout.item.kind === "work_record")
      return React.createElement(WorkRecord, { layout: { ...layout, item: layout.item }, render });
    let content = render(layout);
    if (session && endsWithResumableError(layout))
      content = React.createElement(
        View,
        null,
        content,
        React.createElement(ResumeAfterInterruption, { session }),
      );
    if (layout.item.kind !== "assistant_message") return content;
    return layout.item.answerStart
      ? React.createElement(Answer, null, content)
      : React.createElement(View, { style: styles.answerContainer }, content);
  };
}
