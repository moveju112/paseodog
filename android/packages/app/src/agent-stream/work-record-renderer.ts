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
  Pressable: ComponentType<ComponentProps<typeof import("react-native").Pressable>>;
  StyleSheet: typeof import("react-native-unistyles").StyleSheet;
  useTranslation: typeof import("react-i18next").useTranslation;
  /** 연결된 호스트 클라이언트 (서버 ID -> 클라이언트, 연결 전이면 null) */
  getClient: (serverId: string) => ContinueClient | null;
}

/** 이 렌더러가 그리는 대화의 세션 (이어서 진행 요청 대상) */
export interface WorkRecordSession {
  serverId: string;
  agentId: string;
}

// 공급자 연결이 끊겨 턴이 중단될 때 데몬이 남기는 오류 본문
const CONNECTION_CLOSED_TEXT = "[System Error] Provider connection closed";

// 원래 Markdown·도구 렌더러를 재사용하고 접기·답변 제목·끊김 후 이어서 진행만 표시 단계에 더한다.
export function createWorkRecordRenderer(deps: RendererDependencies) {
  const { React, View, Text, Pressable, StyleSheet, useTranslation, getClient } = deps;
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
      record: "추론·진행 기록",
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
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: theme.borderRadius.md,
      overflow: "hidden",
    },
    header: {
      uni__dependencies: [0],
      flexDirection: "row",
      alignItems: "center",
      padding: theme.spacing[2],
      gap: theme.spacing[2],
    },
    title: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
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
      paddingHorizontal: theme.spacing[2],
      paddingBottom: theme.spacing[2],
    },
    body: { uni__dependencies: [0], padding: theme.spacing[2], gap: theme.spacing[2] },
    footer: {
      uni__dependencies: [0],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[1],
      padding: theme.spacing[2],
      borderTopColor: theme.colors.border,
      borderTopWidth: 1,
    },
    label: {
      uni__dependencies: [0],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      marginBottom: theme.spacing[1],
    },
    answer: {
      uni__dependencies: [0],
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
      marginBottom: theme.spacing[2],
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
          style: styles.header,
          testID: "assistant-work-record-toggle",
          accessibilityRole: "button",
          accessibilityLabel: copy.record,
          accessibilityState: { expanded },
          onPress: () => setExpanded(!expanded),
        },
        React.createElement(Text, { style: styles.count, accessible: false }, expanded ? "⌄" : "›"),
        React.createElement(Text, { style: styles.title }, copy.record),
        React.createElement(Text, { style: styles.count }, String(record.count)),
      ),
      record.active && !expanded
        ? React.createElement(
            Text,
            { style: styles.preview, numberOfLines: 1 },
            record.preview || copy.working,
          )
        : null,
      expanded
        ? React.createElement(
            View,
            { style: styles.body },
            record.items.map((item, index) =>
              React.createElement(
                View,
                { key: item.id },
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

  // 답변 제목은 첫 Markdown 블록에만 달아 표·코드·링크 등 기존 본문 표시를 유지한다.
  function Answer({ children }: { children: ReactNode }) {
    const copy = useCopy();
    return React.createElement(
      View,
      { testID: "assistant-answer" },
      React.createElement(Text, { style: styles.answer, accessibilityRole: "header" }, copy.answer),
      children,
    );
  }

  // 연결 끊김으로 끝난 마지막 턴 아래 버튼 (누름 -> 같은 세션에 "이어서 진행" 새 메시지 1회 전송)
  function ResumeAfterDisconnect({ session }: { session: WorkRecordSession }) {
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

  // 대화 맨 끝이 연결 끊김 오류로 끝난 완료 턴인지 (이후 메시지가 생기면 버튼은 사라진다)
  function endsWithDisconnect(layout: StreamLayoutItem): boolean {
    return (
      layout.item.kind === "assistant_message" &&
      layout.item.text.trim() === CONNECTION_CLOSED_TEXT &&
      layout.belowItem === null &&
      layout.phase === "complete"
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
    if (session && endsWithDisconnect(layout))
      content = React.createElement(
        View,
        null,
        content,
        React.createElement(ResumeAfterDisconnect, { session }),
      );
    return layout.item.kind === "assistant_message" && layout.item.answerStart
      ? React.createElement(Answer, null, content)
      : content;
  };
}
