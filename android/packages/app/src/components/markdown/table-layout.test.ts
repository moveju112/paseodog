import { describe, expect, it } from "vitest";
import { fitTableColumns } from "./table-layout";

describe("content-sized markdown columns", () => {
  it("keeps a short number column narrow and gives long columns the remaining space", () => {
    expect(fitTableColumns([30, 500, 800], 350)).toEqual([30, 160, 160]);
  });
  it("uses the maximum header and body measurements without breaking row alignment", () => {
    expect(fitTableColumns([90, 500, 800], 350)).toEqual([90, 130, 130]);
    expect(fitTableColumns([30, 80, 800], 350)).toEqual([30, 80, 240]);
  });
  it("fits narrow screens, empty cells and short tables", () => {
    expect(fitTableColumns([80, 90, 100], 90)).toEqual([30, 30, 30]);
    expect(fitTableColumns([10, 20, 30], 300)).toEqual([50, 100, 150]);
    expect(fitTableColumns([0, 0], 100)).toEqual([50, 50]);
    expect(fitTableColumns([], 100)).toEqual([]);
    expect(fitTableColumns([80], 0)).toEqual([]);
  });
});
