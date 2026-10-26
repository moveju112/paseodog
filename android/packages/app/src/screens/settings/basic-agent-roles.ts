export const basicAgentIds = [
  "maintainer",
  "title-generator",
  "context-explorer",
  "failure-analyst",
  "handoff-summarizer",
  "context-compressor",
  "reviewer",
] as const;

export function isBasicAgent(agent: { id: string }): boolean {
  return basicAgentIds.some((id) => id === agent.id);
}
