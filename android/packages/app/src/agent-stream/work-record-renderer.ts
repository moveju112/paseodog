import type { StreamLayoutItem } from "./layout";
import type { WorkRecordItem } from "@/types/stream";
import type { ReactNode, ComponentType, ComponentProps } from "react";

interface RendererDependencies {
  React: typeof import("react");
  View: ComponentType<ComponentProps<typeof import("react-native").View>>;
  Text: ComponentType<ComponentProps<typeof import("react-native").Text>>;
  Pressable: ComponentType<ComponentProps<typeof import("react-native").Pressable>>;
  StyleSheet: typeof import("react-native-unistyles").StyleSheet;
  useTranslation: typeof import("react-i18next").useTranslation;
}

// 원래 Markdown·도구 렌더러를 재사용하고 접기·답변 제목만 표시 단계에 더한다.
export function createWorkRecordRenderer(deps: RendererDependencies) {
  const { React, View, Text, Pressable, StyleSheet, useTranslation } = deps;
  const copies: Record<
    string,
    { record: string; answer: string; progress: string; working: string }
  > = {
    en: {
      record: "Reasoning & progress",
      answer: "Answer",
      progress: "Progress",
      working: "Working…",
    },
    ko: {
      record: "추론·진행 기록",
      answer: "답변",
      progress: "진행 안내",
      working: "작업 진행 중…",
    },
    ja: { record: "思考・進捗", answer: "回答", progress: "進捗", working: "作業中…" },
    zh: { record: "推理与进度", answer: "回答", progress: "进度", working: "处理中…" },
    fr: {
      record: "Réflexion et progression",
      answer: "Réponse",
      progress: "Progression",
      working: "En cours…",
    },
    es: {
      record: "Razonamiento y progreso",
      answer: "Respuesta",
      progress: "Progreso",
      working: "En curso…",
    },
    pt: {
      record: "Raciocínio e progresso",
      answer: "Resposta",
      progress: "Progresso",
      working: "Em andamento…",
    },
    ru: {
      record: "Рассуждения и ход работы",
      answer: "Ответ",
      progress: "Ход работы",
      working: "В работе…",
    },
    ar: { record: "التفكير والتقدم", answer: "الإجابة", progress: "التقدم", working: "جارٍ العمل…" },
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
  }));

  // 기존 앱 언어를 읽고 알 수 없는 로케일만 영어로 표시한다.
  function useCopy() {
    const { i18n } = useTranslation();
    const locale = (i18n.resolvedLanguage ?? i18n.language).split("-")[0]!;
    return copies[locale] ?? copies.en!;
  }

  // 기본 접힘을 유지하고 작업이 끝나면 펼쳐 두었던 진행 기록도 접는다.
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

  return (layout: StreamLayoutItem, render: (row: StreamLayoutItem) => ReactNode): ReactNode => {
    if (layout.item.kind === "work_record")
      return React.createElement(WorkRecord, { layout: { ...layout, item: layout.item }, render });
    const content = render(layout);
    return layout.item.kind === "assistant_message" && layout.item.answerStart
      ? React.createElement(Answer, null, content)
      : content;
  };
}
