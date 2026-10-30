import type { StreamItem, WorkRecordItem } from "@/types/stream";

export interface WorkRecordCache {
  records: Map<string, WorkRecordItem>;
  answers: WeakMap<StreamItem, StreamItem>;
  tail?: StreamItem[];
  head?: StreamItem[];
}

// 기록은 위 요청에 가깝게 붙이고 다음 요청과는 넓게 구분한다.
export function getWorkRecordGap(
  item: StreamItem | null,
  belowItem: StreamItem | null,
): number | null {
  if (item?.kind === "user_message" && belowItem?.kind === "work_record") return 8;
  if (item?.kind === "work_record" && belowItem?.kind === "user_message") return 24;
  if (item?.kind === "work_record" && belowItem?.kind === "assistant_message") return 16;
  return null;
}

// 명시된 본문 단계와 턴 경계로 표시만 묶으며 원본 항목·모델 대화는 바꾸지 않는다.
export function projectWorkRecords<
  T extends { tail: StreamItem[]; head: StreamItem[]; groupsByHostId?: unknown },
>(
  input: T,
  isTurnActive: boolean,
  cache: WorkRecordCache = { records: new Map(), answers: new WeakMap() },
  hideReasoning = false,
): T {
  const items = [...input.tail, ...input.head];
  const keys = new Map<StreamItem, string | null>();
  const groups = new Map<string | null, StreamItem[]>();
  let userKey: string | null = null;
  let turnId: string | undefined;
  for (const item of items) {
    if (item.kind === "user_message") {
      userKey = item.id;
      turnId = item.turnId;
    } else if (item.turnId !== undefined) turnId = item.turnId;
    const key = userKey === null ? (turnId ?? null) : JSON.stringify([userKey, turnId]);
    keys.set(item, key);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const active = isTurnActive && items.length ? keys.get(items[items.length - 1]!) : undefined;
  const replacements = new Map<StreamItem, StreamItem>();
  const hidden = new Set<StreamItem>();
  const seen = new Set<string>();

  // 승인·오류·플러그인 내용은 접힌 기록 안으로 감추지 않는다.
  function isRecord(item: StreamItem): boolean {
    if (item.kind === "tool_call")
      return !["failed", "canceled"].includes(item.payload.data.status);
    if (item.kind === "notification") {
      // 이전 버전이 warning으로 저장한 로컬 명령 요약도 도구 결과와 함께 기록 안에 보존한다.
      return (
        item.level === "info" ||
        (item.level === "warning" &&
          item.sourceType === "notification" &&
          /^(?:백그라운드 명령 실행 결과|로컬 명령 job_[A-Za-z0-9_-]+): (?:성공|실패|취소)\.$/.test(
            item.message,
          ))
      );
    }
    return (
      item.kind === "assistant_message" ||
      item.kind === "thought" ||
      item.kind === "todo_list" ||
      item.kind === "compaction"
    );
  }

  // 같은 원본 메시지의 Markdown 블록은 모두 하나의 답변으로 유지한다.
  function sourceId(item: StreamItem): string {
    return item.kind === "assistant_message" ? (item.blockGroupId ?? item.id) : item.id;
  }

  // 기존 항목 참조를 재사용해 무관한 과거 기록을 스트림 토큰마다 다시 렌더링하지 않는다.
  function recordFor(key: string | null, records: StreamItem[], running: boolean): WorkRecordItem {
    const anchor = records[0]!;
    const id = `work-record:${key ?? anchor.id}`;
    seen.add(id);
    const previous = cache.records.get(id);
    if (
      previous &&
      previous.active === running &&
      previous.groupRevision === input.groupsByHostId &&
      previous.items.length === records.length &&
      previous.items.every((item, index) => item === records[index])
    )
      return previous;
    const latest = records.findLast(
      (item) => item.kind === "assistant_message" && item.assistantPhase !== "final_answer",
    );
    const record: WorkRecordItem = {
      kind: "work_record",
      id,
      timestamp: anchor.timestamp,
      turnId: anchor.turnId,
      timelineCursor: anchor.timelineCursor,
      items: records,
      active: running,
      count: new Set(records.map(sourceId)).size,
      preview: latest?.kind === "assistant_message" ? latest.text : "",
      groupRevision: input.groupsByHostId,
    };
    cache.records.set(id, record);
    return record;
  }

  // 도구 이후 이어지는 명시 답변 조각을 보존하고 레거시는 마지막 메시지 경계만 쓴다.
  function answerSources(group: StreamItem[], key: string | null): Set<string> {
    const answers = new Set<string>();
    for (const item of group) {
      if (item.kind === "tool_call") answers.clear();
      if (item.kind !== "assistant_message") continue;
      if (item.assistantPhase === "final_answer" && (!hideReasoning || key !== active))
        answers.add(sourceId(item));
      else if (!item.assistantPhase && key !== active) {
        answers.clear();
        answers.add(sourceId(item));
      } else answers.clear();
    }
    // 진행 중 턴: 도구가 뒤따르지 않은 마지막 미표시 본문은 단계가 끝에서야 붙어도 답변 자리에 바로 흘린다
    const last = group.findLast(
      (item) => item.kind === "assistant_message" || item.kind === "tool_call",
    );
    if (
      key === active &&
      !hideReasoning &&
      last?.kind === "assistant_message" &&
      !last.assistantPhase
    )
      answers.add(sourceId(last));
    return answers;
  }

  for (const [key, group] of groups) {
    const answers = answerSources(group, key);
    const answerItems = group.filter(
      (item) => item.kind === "assistant_message" && answers.has(sourceId(item)),
    );
    const answerSet = new Set(answerItems);
    const records = group.filter((item) => isRecord(item) && !answerSet.has(item));
    if (records.length) {
      for (const item of records) hidden.add(item);
      if (!hideReasoning) {
        const anchor = records[0]!;
        hidden.delete(anchor);
        replacements.set(anchor, recordFor(key, records, key === active));
      }
    }
    const first = answerItems[0];
    if (first?.kind === "assistant_message") {
      let decorated = cache.answers.get(first);
      if (!decorated) {
        decorated = { ...first, answerStart: true };
        cache.answers.set(first, decorated);
      }
      replacements.set(first, decorated);
    }
  }
  for (const id of cache.records.keys()) if (!seen.has(id)) cache.records.delete(id);

  // 과거 배열이 실제로 달라지지 않았으면 레이아웃·가상 목록 캐시도 유지한다.
  function project(source: StreamItem[], previous?: StreamItem[]): StreamItem[] {
    const result = source
      .filter((item) => !hidden.has(item))
      .map((item) => replacements.get(item) ?? item);
    return previous &&
      previous.length === result.length &&
      previous.every((item, index) => item === result[index])
      ? previous
      : result;
  }
  cache.tail = project(input.tail, cache.tail);
  cache.head = project(input.head, cache.head);
  return { ...input, tail: cache.tail, head: cache.head };
}
