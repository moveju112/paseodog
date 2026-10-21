import { describe, expect, it } from "vitest";
import { getProjectStatusBadgeContent } from "./project-status-badge-content";

describe("getProjectStatusBadgeContent", () => {
  it("shows a running dot while working", () => {
    expect(getProjectStatusBadgeContent("running")).toEqual({ kind: "dot", bucket: "running" });
  });

  it("shows the alert when input is needed", () => {
    expect(getProjectStatusBadgeContent("needs_input")).toEqual({ kind: "alert" });
  });

  it("shows a failed dot when a workspace failed", () => {
    expect(getProjectStatusBadgeContent("failed")).toEqual({ kind: "dot", bucket: "failed" });
  });

  it("shows a check when a completed response awaits review", () => {
    expect(getProjectStatusBadgeContent("attention")).toEqual({
      kind: "check",
      bucket: "attention",
    });
  });

  it("shows a check when the project is done", () => {
    expect(getProjectStatusBadgeContent("done")).toEqual({ kind: "check", bucket: "done" });
  });

  it("shows nothing when there is no aggregate bucket to surface", () => {
    expect(getProjectStatusBadgeContent(null)).toBeNull();
  });
});
