import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(new URL(
    '../android/packages/app/src/components/markdown/table-layout.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const { createMarkdownTableComponents, fitTableColumns } = new Function(
    `${source}\nreturn { createMarkdownTableComponents, fitTableColumns };`)();
const tableModuleEnd = 'const c=(0,n.createContext)("prose")},4287,[455,36,279]);';

export const MARKDOWN_TABLE_EDITS = [
    [tableModuleEnd,
        `const c=(0,n.createContext)("prose");const table=(${createMarkdownTableComponents})(n,r(d[3]).View,r(d[4]).Text,${fitTableColumns});e.MarkdownTable=table.Table;e.MarkdownTableCell=table.Cell},4287,[455,36,279,897,898]);`],
    ['th:(t,n,s,l)=>(0,z.jsx)(w.MarkdownTableCellText,{children:(0,z.jsx)(e.View,{style:l._VIEW_SAFE_th,children:n})},t.key)',
        'table:(t,n,s,l)=>(0,z.jsx)(w.MarkdownTable,{node:t,styles:l,children:n},t.key),th:(t,n,s,l)=>(0,z.jsx)(w.MarkdownTableCellText,{children:(0,z.jsx)(w.MarkdownTableCell,{node:t,parent:s,style:l._VIEW_SAFE_th,children:n})},t.key)'],
    ['td:(t,n,s,l)=>(0,z.jsx)(w.MarkdownTableCellText,{children:(0,z.jsx)(e.View,{style:l._VIEW_SAFE_td,children:n})},t.key)',
        'td:(t,n,s,l)=>(0,z.jsx)(w.MarkdownTableCellText,{children:(0,z.jsx)(w.MarkdownTableCell,{node:t,parent:s,style:l._VIEW_SAFE_td,children:n})},t.key)'],
    ['table:(e,t,n,o)=>(0,ce.jsx)(s.View,{style:o._VIEW_SAFE_table,dataSet:se.markdownCopyDataSet.table,children:t},e.key)',
        'table:(e,t,n,o)=>(0,ce.jsx)(y.MarkdownTable,{node:e,styles:o,dataSet:se.markdownCopyDataSet.table,children:t},e.key)'],
    ...['th', 'td'].map((tag) => [
        `${tag}:(e,t,n,o)=>(0,ce.jsx)(y.MarkdownTableCellText,{children:(0,ce.jsx)(s.View,{style:o._VIEW_SAFE_${tag},dataSet:(0,se.markdownCopyTableCellDataSet)("${tag}",e.attributes?.style),children:t})},e.key)`,
        `${tag}:(e,t,n,o)=>(0,ce.jsx)(y.MarkdownTableCellText,{children:(0,ce.jsx)(y.MarkdownTableCell,{node:e,parent:n,style:o._VIEW_SAFE_${tag},dataSet:(0,se.markdownCopyTableCellDataSet)("${tag}",e.attributes?.style),children:t})},e.key)`,
    ]),
];

// 이미 설치된 11066·11073 표 패치를 현재 구현으로 올리기 위한 정확한 이전 셀 스타일이다.
const CURRENT_CELL_STYLE = `    // 셀 기본 flex: 1을 유지하고 측정 폭은 flexGrow 비율로만 반영한다.
    // Android에서 마운트 뒤 width·flexBasis를 지정하면 셀이 padding 폭으로 접힌다.
    return React.createElement(View, {
      dataSet,
      style: [style, { minWidth: 0 }, widths[column] !== undefined && { flexGrow: widths[column] }],`;
const LEGACY_CELL_STYLES = [`    return React.createElement(View, {
      dataSet,
      style: [style, { minWidth: 0 }, widths[column] !== undefined && {
        flex: undefined, flexBasis: "auto", flexGrow: 0, flexShrink: 0, width: widths[column],
      }],`, `    // Android는 갱신 시 undefined로 기존 flex: 1을 지우지 않으므로 측정 폭을 기본 크기로 명시한다.
    return React.createElement(View, {
      dataSet,
      style: [style, { minWidth: 0 }, widths[column] !== undefined && {
        flex: 0, flexBasis: widths[column], flexGrow: 0, flexShrink: 0, width: widths[column],
      }],`];
export const LEGACY_MARKDOWN_TABLE_EDITS = LEGACY_CELL_STYLES.map((cellStyle) => [
    [MARKDOWN_TABLE_EDITS[0][0], MARKDOWN_TABLE_EDITS[0][1].replace(CURRENT_CELL_STYLE, () => cellStyle)],
    ...MARKDOWN_TABLE_EDITS.slice(1)]);

// 전체 번들 해시 검증 전에 열 너비 변경만 완전히 해제한다.
export function withoutMarkdownTable(source) {
    const edits = LEGACY_MARKDOWN_TABLE_EDITS.find(([[, after]]) => source.includes(after)) ?? MARKDOWN_TABLE_EDITS;
    const counts = edits.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Markdown table patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial markdown table patch');
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}

// 원본의 단일 앵커에 공유 테이블 구현을 연결한다.
export function withMarkdownTable(source) {
    for (const [before, after] of MARKDOWN_TABLE_EDITS) {
        if (source.split(before).length !== 2) throw new Error('Markdown table anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}
