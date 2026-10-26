import { describe, expect, it } from "vitest";
import { basicAgentIds, isBasicAgent } from "./basic-agent-roles";

describe("basic agent roles", () => {
  it("groups independent maintenance and conditional roles without hiding ordinary agents", () => {
    const ids = [
      "maintainer",
      "title-generator",
      "context-explorer",
      "failure-analyst",
      "handoff-summarizer",
      "context-compressor",
      "reviewer",
    ];
    expect([...basicAgentIds]).toEqual(ids);
    const rows = [...ids, "worker", "advisor", "custom-bot"].map((id) => ({ id }));
    expect(rows.filter(isBasicAgent).map(({ id }) => id)).toEqual(ids);
    expect(rows.filter((row) => !isBasicAgent(row)).map(({ id }) => id)).toEqual([
      "worker",
      "advisor",
      "custom-bot",
    ]);
    expect(isBasicAgent({ id: "" })).toBe(false);
  });
});
