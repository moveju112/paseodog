import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Text, View } from "react-native";
import type { ASTNode } from "react-native-markdown-display";
import { MarkdownTable, MarkdownTableCell } from "./table";

describe("measured markdown table layout", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "350px";
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    root.unmount();
    container.remove();
  });

  function render(values: string[][], fontSize = 16) {
    const base = { sourceType: "", markup: "", tokenIndex: 0, index: 0, attributes: {} };
    const rows = values.map((row, index) => ({
      ...base, type: "tr", key: `r${index}`, content: "", children: row.map((content, column) => ({
        ...base,
        type: index ? "td" : "th", key: `${index}-${column}`, content, children: [],
      })),
    }));
    const node: ASTNode = { ...base, type: "table", key: "table", content: "", children: rows };
    const cellStyle = { padding: 8, borderRightWidth: 1, flex: 1, fontSize };
    const styles = {
      body: { fontSize },
      th: { ...cellStyle, fontWeight: "600" as const },
      td: cellStyle,
      _VIEW_SAFE_table: { borderWidth: 1 },
    };
    root.render(React.createElement(MarkdownTable, { node, styles },
      rows.map((row, index) => React.createElement(View, {
        key: row.key, style: { flexDirection: "row" },
      }, row.children.map((cell, column) => React.createElement(MarkdownTableCell, {
        key: cell.key, node: cell, parent: [row], style: cellStyle,
        dataSet: { cell: `${index}-${column}` },
      }, React.createElement(Text, { style: { fontSize } }, cell.content))))),
    ));
  }

  function rect(row: number, column: number) {
    return container.querySelector(`[data-cell="${row}-${column}"]`)!.getBoundingClientRect();
  }

  it("narrows number columns, aligns every row and preserves full text on mobile widths", async () => {
    const values = [["#", "문제", "설명"], ["1", "긴 내용 ".repeat(20), "다른 긴 내용 ".repeat(20)]];
    render(values);
    await expect.poll(() => rect(0, 0).width).toBeLessThan(60);
    await expect.poll(() => rect(0, 1).width).toBeGreaterThan(120);
    for (let column = 0; column < 3; column++) {
      expect(rect(0, column).width).toBeCloseTo(rect(1, column).width, 1);
      expect(rect(0, column).left).toBeCloseTo(rect(1, column).left, 1);
    }
    expect(container.querySelector('[data-cell="1-2"]')!.textContent).toBe(values[1]![2]);
    expect(rect(1, 2).right).toBeLessThanOrEqual(container.getBoundingClientRect().right);

    container.style.width = "280px";
    await expect.poll(() => rect(1, 2).right).toBeLessThanOrEqual(container.getBoundingClientRect().right);
    expect(rect(0, 0).width).toBeLessThan(60);
  });

  it("remeasures changed content and larger fonts, including a longer header", async () => {
    render([["#", "내용"], ["1", "긴 내용 ".repeat(20)]]);
    await expect.poll(() => rect(0, 0).width).toBeLessThan(60);
    render([["식별 번호", "내용"], ["123456", "긴 내용 ".repeat(20)]], 22);
    await expect.poll(() => rect(0, 0).width).toBeGreaterThan(90);
    expect(rect(0, 0).width).toBeCloseTo(rect(1, 0).width, 1);
  });
});
