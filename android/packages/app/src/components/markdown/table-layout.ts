import type * as ReactTypes from "react";
import type { View as NativeView, Text as NativeText, ViewStyle, TextStyle } from "react-native";
import type { ASTNode } from "react-native-markdown-display";

// 짧은 열은 필요한 폭만 유지하고, 남은 폭을 아직 긴 열 사이에 나눈다.
export function fitTableColumns(preferred: number[], available: number): number[] {
  if (preferred.length === 0 || available <= 0) return [];
  const total = preferred.reduce((sum, width) => sum + width, 0);
  if (total <= available) {
    return preferred.map((width) => total ? (width / total) * available : available / preferred.length);
  }
  const widths = preferred.slice();
  let remaining = available;
  let pending = preferred.map((_, index) => index);
  while (pending.length) {
    const share = remaining / pending.length;
    const short = pending.filter((index) => preferred[index]! <= share);
    if (!short.length) {
      for (const index of pending) widths[index] = share;
      break;
    }
    for (const index of short) remaining -= preferred[index]!;
    pending = pending.filter((index) => !short.includes(index));
  }
  return widths;
}

type Styles = Record<string, TextStyle & ViewStyle>;
interface TableProps {
  node: ASTNode;
  styles: Styles;
  children?: ReactTypes.ReactNode;
  dataSet?: Record<string, string>;
}
interface CellProps {
  node: ASTNode;
  parent: ASTNode[];
  style: ViewStyle;
  children?: ReactTypes.ReactNode;
  dataSet?: Record<string, string>;
}

// APK·PC·고정 웹 번들이 같은 측정·열 배분 구현을 사용한다.
export function createMarkdownTableComponents(
  React: typeof ReactTypes,
  View: typeof NativeView,
  Text: typeof NativeText,
  fitColumns: typeof fitTableColumns,
) {
  const Widths = React.createContext<number[]>([]);

  function textContent(node: ASTNode): string {
    if (node.type === "softbreak" || node.type === "hardbreak") return "\n";
    return node.children?.length ? node.children.map(textContent).join("") : node.content ?? "";
  }

  function rows(node: ASTNode): ASTNode[] {
    return node.type === "tr" ? [node] : (node.children ?? []).flatMap(rows);
  }

  function measurementCells(node: ASTNode, styles: Styles, available: number) {
    return rows(node).flatMap((row) =>
      row.children.flatMap((cell, column) => {
        const style = { ...styles.body, ...styles[cell.type] };
        const font: TextStyle = {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          letterSpacing: style.letterSpacing,
        };
        const padding = Number(style.paddingHorizontal ?? style.padding ?? 0) * 2
          + Number(style.borderLeftWidth ?? 0) + Number(style.borderRightWidth ?? 0);
        return textContent(cell).split("\n").map((text, line) => ({
          column, text, font, padding,
          key: JSON.stringify([cell.key, line, text, font, padding, available]),
        }));
      }));
  }

  function Table({ node, styles, children, dataSet }: TableProps) {
    const [available, setAvailable] = React.useState(0);
    const [measured, setMeasured] = React.useState<Record<string, number>>({});
    const cells = React.useMemo(() => measurementCells(node, styles, available), [node, styles, available]);
    const keys = React.useMemo(() => new Set(cells.map((cell) => cell.key)), [cells]);
    const activeKeys = React.useRef(keys);
    activeKeys.current = keys;
    React.useEffect(() => {
      setMeasured((previous) => Object.keys(previous).some((key) => !keys.has(key))
        ? Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key)))
        : previous);
    }, [keys]);

    const count = cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0);
    const preferred = Array<number>(count).fill(0);
    for (const cell of cells) {
      preferred[cell.column] = Math.max(
        preferred[cell.column]!,
        measured[cell.key] ?? (available / Math.max(count, 1)),
      );
    }
    const widths = fitColumns(preferred, available);

    return React.createElement(View, { style: styles._VIEW_SAFE_table, dataSet },
      React.createElement(View, {
        style: { minWidth: 0 },
        onLayout: (event) => setAvailable(event.nativeEvent.layout.width),
      },
      React.createElement(Widths.Provider, { value: widths }, children),
      available > 0 && React.createElement(View, {
        pointerEvents: "none",
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants",
        "aria-hidden": true,
        style: { position: "absolute", width: "100%", height: 0, overflow: "hidden", opacity: 0 },
      }, cells.map((cell) => React.createElement(Text, {
        key: cell.key,
        selectable: false,
        numberOfLines: 1,
        style: [cell.font, { alignSelf: "flex-start", maxWidth: "100%", userSelect: "none" }],
        onLayout: (event) => {
          const width = Math.ceil(event.nativeEvent.layout.width) + cell.padding;
          if (!activeKeys.current.has(cell.key)) return;
          setMeasured((previous) => previous[cell.key] === width
            ? previous : { ...previous, [cell.key]: width });
        },
      }, cell.text || " ")))));
  }

  function Cell({ node, parent, style, children, dataSet }: CellProps) {
    const widths = React.useContext(Widths);
    const column = parent[0]?.children.findIndex((cell) => cell.key === node.key) ?? -1;
    // 셀 기본 flex: 1을 유지하고 측정 폭은 flexGrow 비율로만 반영한다.
    // Android에서 마운트 뒤 width·flexBasis를 지정하면 셀이 padding 폭으로 접힌다.
    return React.createElement(View, {
      dataSet,
      style: [style, { minWidth: 0 }, widths[column] !== undefined && { flexGrow: widths[column] }],
    }, children);
  }

  return { Table, Cell };
}
