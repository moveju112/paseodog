import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type ProjectStatusBadgeDotBucket = "failed" | "attention" | "running";

export type ProjectStatusBadgeContent =
  | { kind: "alert" }
  | { kind: "check"; bucket: "attention" | "done" }
  | { kind: "dot"; bucket: ProjectStatusBadgeDotBucket };

/**
 * What the project status badge should render for a project's aggregate bucket, or null when
 * no badge should show at all. Kept as plain data (no React) so it's testable without JSDOM
 * or component mounting — see docs/testing.md's two test categories.
 *
 * 진행 링·완료 체크·입력 대기 느낌표를 같은 슬롯에서 구분한다.
 * 실패 표시는 기존 위험 상태를 보존한다.
 */
export function getProjectStatusBadgeContent(
  statusBucket: SidebarStateBucket | null,
): ProjectStatusBadgeContent | null {
  if (statusBucket === "needs_input") {
    return { kind: "alert" };
  }
  if (statusBucket === "attention" || statusBucket === "done") {
    return { kind: "check", bucket: statusBucket };
  }
  if (statusBucket === "failed" || statusBucket === "running") {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}
