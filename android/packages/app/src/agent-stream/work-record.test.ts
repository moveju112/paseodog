import { expect, test } from "vitest";
import { applyStreamEvent, type StreamItem } from "@/types/stream";
import { createStreamPresentation } from "./presentation";
import { buildAgentStreamRenderModel } from "./model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import { projectWorkRecords } from "./work-record-model";
import { getGapBetweenStreamItems } from "./spacing";

test("steered requests in one native turn keep their own nearby records across history and live rows", () => {
  const timestamp = new Date(1);
  const request: StreamItem = {
    kind: "user_message",
    id: "chrome",
    turnId: "turn",
    timestamp,
    text: "크롬 설치해도 괜찮아",
  };
  const progress: StreamItem = {
    kind: "assistant_message",
    id: "checking",
    turnId: "turn",
    timestamp,
    text: "검증 중",
    assistantPhase: "commentary",
  };
  const next: StreamItem = { ...request, id: "proceed", text: "좋아 다 진행해" };
  const installing: StreamItem = { ...progress, id: "installing", text: "승인대로 설치할게" };
  const result = projectWorkRecords({ tail: [request, progress, next], head: [installing] }, true);
  expect(result.tail.map((item) => item.kind)).toEqual([
    "user_message",
    "work_record",
    "user_message",
  ]);
  const previousRecord = result.tail[1]!;
  const currentRecord = result.head[0]!;
  expect(previousRecord).toMatchObject({ items: [progress], active: false });
  expect(currentRecord).toMatchObject({ items: [installing], active: true });
  expect(previousRecord.id).not.toBe(currentRecord.id);
  expect(getGapBetweenStreamItems(request, previousRecord)).toBe(8);
  expect(getGapBetweenStreamItems(previousRecord, next)).toBe(24);
  expect(getGapBetweenStreamItems(next, currentRecord)).toBe(8);
});

test("missing per-item turn metadata does not detach progress from its request", () => {
  const timestamp = new Date(1);
  const request: StreamItem = {
    kind: "user_message",
    id: "request",
    turnId: "turn",
    timestamp,
    text: "요청",
  };
  const progress: StreamItem = {
    kind: "assistant_message",
    id: "progress",
    timestamp,
    text: "진행",
    assistantPhase: "commentary",
  };
  const answer: StreamItem = {
    ...progress,
    id: "answer",
    turnId: "turn",
    text: "답변",
    assistantPhase: "final_answer",
  };
  const result = projectWorkRecords({ tail: [request, progress], head: [answer] }, false);
  expect(result.tail[1]).toMatchObject({ kind: "work_record", items: [progress] });
  expect(result.head[0]).toMatchObject({ kind: "assistant_message", answerStart: true });
  expect(getGapBetweenStreamItems(result.tail[1]!, result.head[0]!)).toBe(16);
});

test("active turn streams an unphased trailing message as the answer until a tool follows", () => {
  const timestamp = new Date(1);
  const request: StreamItem = {
    kind: "user_message",
    id: "request",
    turnId: "turn",
    timestamp,
    text: "요청",
  };
  const preamble: StreamItem = {
    kind: "assistant_message",
    id: "preamble",
    turnId: "turn",
    timestamp,
    text: "확인할게",
  };
  const streaming: StreamItem = { ...preamble, id: "streaming", text: "답변 작성 중" };
  const tool = {
    kind: "tool_call",
    id: "tool",
    turnId: "turn",
    timestamp,
    payload: { source: "agent", data: { status: "running" } },
  } as unknown as StreamItem;

  const live = projectWorkRecords({ tail: [request, preamble, tool], head: [streaming] }, true);
  expect(live.tail[1]).toMatchObject({ kind: "work_record", items: [preamble, tool] });
  expect(live.head[0]).toMatchObject({ id: "streaming", answerStart: true });

  // 도구가 뒤따르면 같은 본문은 진행 기록으로 들어간다
  const nextTool = { ...tool, id: "next-tool" } as StreamItem;
  const moved = projectWorkRecords({ tail: [request, streaming], head: [nextTool] }, true);
  expect([...moved.tail, ...moved.head].some((item) => item.kind === "assistant_message")).toBe(
    false,
  );

  // 명시된 commentary는 마지막이어도 기록에 남는다
  const commentary = { ...streaming, assistantPhase: "commentary" } as StreamItem;
  const tagged = projectWorkRecords({ tail: [request], head: [commentary] }, true);
  expect(tagged.head[0]).toMatchObject({ kind: "work_record" });

  // 추론 숨기기 모드는 기존 규칙을 유지한다
  const hidden = projectWorkRecords({ tail: [request], head: [streaming] }, true, undefined, true);
  expect(hidden.head).toHaveLength(0);
});

test("late native phase survives the real live reducer and Markdown projection", () => {
  const timestamp = new Date(1);
  const event = {
    type: "timeline" as const,
    provider: "paseodog",
    turnId: "turn",
    item: { type: "assistant_message" as const, text: "답변", messageId: "native-message" },
  };
  const first = applyStreamEvent({ tail: [], head: [], event, timestamp });
  const late = applyStreamEvent({
    tail: first.tail,
    head: first.head,
    event: { ...event, item: { ...event.item, text: "", phase: "final_answer" } },
    timestamp,
  });
  const messages = [...late.tail, ...late.head].filter((item) => item.kind === "assistant_message");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ text: "답변", assistantPhase: "final_answer" });
  const present = createStreamPresentation();
  const result = present({
    tail: late.tail,
    head: late.head,
    transform: undefined,
    level: "detailed",
    isTurnActive: false,
    groupWorkRecords: true,
  });
  expect(
    [...result.tail, ...result.head].find((item) => item.kind === "assistant_message"),
  ).toMatchObject({ text: "답변", answerStart: true });
});

test.each(["web", "native"] as const)(
  "A work records remain renderable in the %s stream model",
  (platform) => {
    const timestamp = new Date(1);
    const items: StreamItem[] = [
      { kind: "user_message", id: "user", turnId: "turn", text: "요청", timestamp },
      { kind: "thought", id: "thought", turnId: "turn", text: "추론", status: "ready", timestamp },
      {
        kind: "assistant_message",
        id: "progress",
        turnId: "turn",
        text: "진행",
        assistantPhase: "commentary",
        timestamp,
      },
      {
        kind: "assistant_message",
        id: "final",
        turnId: "turn",
        text: "답변",
        assistantPhase: "final_answer",
        timestamp,
      },
    ];
    const presentation = createStreamPresentation()({
      tail: items,
      head: [],
      transform: undefined,
      level: "detailed",
      isTurnActive: false,
      groupWorkRecords: true,
    });
    const model = buildAgentStreamRenderModel({
      tail: presentation.tail,
      head: presentation.head,
      isTurnActive: false,
      activeTurnStartedAt: null,
      platform,
      isMobileBreakpoint: platform === "native",
    });
    expect(model.history.some((item) => item.kind === "work_record")).toBe(true);
    expect(
      model.history.some((item) => item.kind === "assistant_message" && item.answerStart),
    ).toBe(true);
    expect(items.map((item) => item.kind)).toEqual([
      "user_message",
      "thought",
      "assistant_message",
      "assistant_message",
    ]);
  },
);

test("display-only work records are never offered to source timeline transformers", () => {
  const timestamp = new Date(1);
  const record: StreamItem = {
    kind: "work_record",
    id: "record",
    timestamp,
    active: false,
    count: 1,
    preview: "",
    items: [{ kind: "thought", id: "thought", timestamp, text: "추론", status: "ready" }],
  };
  let calls = 0;
  const result = projectPluginTimelineItems([record], () => {
    calls++;
    return undefined;
  });
  expect(calls).toBe(0);
  expect(result[0]).toBe(record);
});
