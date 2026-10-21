import type { AssistantMessageItem, StreamItem, UserMessageItem } from "@/types/stream";
import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { projectWorkRecords, type WorkRecordCache } from "./work-record-model";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  level: ToolCallDetailLevel;
  isTurnActive: boolean;
  /** Display-only: show completed final answers; source items and model history stay intact. */
  hideReasoning?: boolean;
  groupWorkRecords?: boolean;
}

// 답변 전용 표시 (턴별 마지막 도구 이후 답변만 유지, 진행 중 본문·도구·추론 행 제외)
function answerOnlyRows(tail: StreamItem[], head: StreamItem[], isTurnActive: boolean) {
  const items = [...tail, ...head];
  const groups = new Map<StreamItem, string | null>();
  const answers = new Map<string | null, string>();
  let group: string | null = null;
  for (const item of items) {
    if (item.kind === "user_message") group = item.id;
    const key = item.turnId ?? group;
    groups.set(item, key);
    if (item.kind === "assistant_message") answers.set(key, item.blockGroupId ?? item.id);
    if (item.kind === "tool_call") answers.delete(key);
  }
  const active = isTurnActive && items.length ? groups.get(items[items.length - 1]!) : undefined;
  // 표시 배열에서 제거해 숨긴 행의 레이아웃 여백도 남기지 않는다.
  const visible = (item: StreamItem) => {
    if (item.kind === "assistant_message") {
      const key = groups.get(item)!;
      return (
        key !== active &&
        answers.get(key) === (item.blockGroupId ?? item.id) &&
        item.text.trim() !== ""
      );
    }
    return (
      item.kind === "user_message" ||
      item.kind === "plugin" ||
      (item.kind === "notification" && item.level !== "info")
    );
  };
  const shown = { tail: tail.filter(visible), head: head.filter(visible) };
  if (shown.tail.length || shown.head.length) return shown;
  // 불러온 범위가 모두 숨겨지면 완료된 턴의 마지막 답변 묶음만 남겨 빈 대화로 보이지 않게 한다.
  let last: StreamItem | null = null;
  for (let index = items.length - 1; index >= 0 && !last; index--) {
    const item = items[index]!;
    if (item.kind === "assistant_message" && groups.get(item) !== active && item.text.trim() !== "")
      last = item;
  }
  if (!last || last.kind !== "assistant_message") return shown;
  const lastId = last.blockGroupId ?? last.id;
  const kept = (item: StreamItem) =>
    item.kind === "assistant_message" &&
    (item.blockGroupId ?? item.id) === lastId &&
    item.text.trim() !== "";
  return { tail: tail.filter(kept), head: head.filter(kept) };
}

function retainItems(previous: StreamItem[], next: StreamItem[]): StreamItem[] {
  return previous.length === next.length && previous.every((item, index) => item === next[index])
    ? previous
    : next;
}

/**
 * The source message a display row belongs to. Every assistant message is split into
 * Markdown blocks, so an assistant row id never equals its message id; anything that
 * addresses a message — find, scroll-to-message, history reveal — asks for this.
 */
export function getStreamItemMessageId(item: StreamItem): string {
  return item.kind === "assistant_message" ? (item.blockGroupId ?? item.id) : item.id;
}

/**
 * A block is reusable only when it still stands for the same source state. Text and
 * turn are what the reader sees; cursor and timestamp are what the timeline reads back
 * through the row — a reused block carrying a pre-canonical cursor reports a stale
 * reading position and weakens fork-boundary resolution.
 */
function isReusableBlock(block: AssistantMessageItem, source: AssistantMessageItem, id: string) {
  return (
    block.id === id &&
    block.assistantPhase === source.assistantPhase &&
    block.turnId === source.turnId &&
    block.timestamp.getTime() === source.timestamp.getTime() &&
    block.timelineCursor?.epoch === source.timelineCursor?.epoch &&
    block.timelineCursor?.seq === source.timelineCursor?.seq
  );
}

/** Source messages reach plugins before any Markdown splitting or Overview grouping. */
export function createStreamPresentation() {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();
  const workRecordCache: WorkRecordCache = { records: new Map(), answers: new WeakMap() };

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  const blocksBySource = new WeakMap<AssistantMessageItem, AssistantMessageItem[]>();
  let liveSources = new Map<string, AssistantMessageItem>();
  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let displayTail: StreamItem[] = [];
  let displayHistory: StreamItem[] | undefined;
  let promotedRows: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;

  /**
   * One display row per Markdown block. Each block renders on its own, so a construct
   * that needs context from another block does not resolve: `splitMarkdownBlocks` keeps
   * link reference definitions with the block that uses them, but a reference pointing
   * at a definition several blocks away renders as literal text. Streamed messages
   * always behaved this way; history now matches them.
   */
  function nativeBlocks(item: StreamItem): StreamItem[] {
    if (item.kind === "user_message") return [presentUserMessage(item)];
    if (item.kind !== "assistant_message") return [item];
    const cached = blocksBySource.get(item);
    if (cached) return cached;
    const previousSource = liveSources.get(item.id);
    const previous = previousSource && blocksBySource.get(previousSource);
    // Parse only the growing last block on append, as the old live reducer did.
    // Canonical text replacements are parsed afresh instead of joining fragments.
    const isAppend = previousSource && previous && item.text.startsWith(previousSource.text);
    let prefix: AssistantMessageItem[] = [];
    let growingText = item.text;
    if (isAppend) {
      prefix = previous.slice(0, -1);
      growingText =
        previous[previous.length - 1]!.text + item.text.slice(previousSource.text.length);
    }
    const parsed = splitMarkdownBlocks(growingText);
    // Whitespace-only text has no block, and a message still owns exactly one row.
    const textBlocks = parsed.length > 0 || prefix.length > 0 ? parsed : [""];

    const blocks = [...prefix];
    for (const [offset, text] of textBlocks.entries()) {
      const index = prefix.length + offset;
      let blockText = text;
      if (offset === textBlocks.length - 1) {
        // The split drops trailing blank lines, including a line break followed only
        // by the next line's indent. Keep them so the next append continues that line.
        const trailingBlankLines = /\n\s*$/.exec(item.text)?.[0] ?? "";
        blockText += trailingBlankLines;
      }
      const existing = previous?.[index];
      const id = `${item.id}:block:${index}`;
      if (existing?.text === blockText && isReusableBlock(existing, item, id)) {
        blocks.push(existing);
        continue;
      }
      blocks.push({
        ...item,
        id,
        blockGroupId: item.id,
        blockIndex: index,
        text: blockText,
      });
    }
    blocksBySource.set(item, blocks);
    return blocks;
  }

  return (input: PresentationInput) => {
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      // One rendering path: history splits the same way the live head does, and
      // `blocksBySource` keeps both the live block identities and the split cost
      // from being paid again when only the tail's array identity changed.
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        nativeBlocks,
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    const promoted: StreamItem[] = [];
    const nextLiveSources = new Map<string, AssistantMessageItem>();
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = nativeBlocks(item);
      if (item.kind === "assistant_message") nextLiveSources.set(item.id, item);
      if (item.kind === "assistant_message" && blocks.length > 1) {
        promoted.push(...blocks.slice(0, -1));
        head.push(blocks[blocks.length - 1]!);
      } else {
        head.push(...blocks);
      }
    }
    liveSources = nextLiveSources;
    const nextPromoted = retainItems(promotedRows, promoted);
    if (displayHistory !== historyRows || nextPromoted !== promotedRows) {
      displayTail = historyRows;
      if (nextPromoted.length > 0) displayTail = [...historyRows, ...nextPromoted];
      displayHistory = historyRows;
      promotedRows = nextPromoted;
    }
    const visible =
      input.hideReasoning && !input.groupWorkRecords
        ? answerOnlyRows(displayTail, head, input.isTurnActive)
        : { tail: displayTail, head };
    const visibleTail = visible.tail;
    if (preparedTail !== visibleTail || preparedLevel !== input.level) {
      preparedHistory = prepareToolCallHistory(input.level, visibleTail);
      preparedTail = visibleTail;
      preparedLevel = input.level;
    }
    const projected = projectToolCallDetailLevel({
      level: input.level,
      tail: visibleTail,
      head: visible.head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
    return input.groupWorkRecords
      ? projectWorkRecords(projected, input.isTurnActive, workRecordCache, input.hideReasoning)
      : projected;
  };
}
