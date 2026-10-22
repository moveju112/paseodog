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

// 전체 번들 해시 검증 전에 열 너비 변경만 완전히 해제한다.
export function withoutMarkdownTable(source) {
    const counts = MARKDOWN_TABLE_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Markdown table patch drift');
    if (counts.includes(0) && counts.some((count) => count > 0)) throw new Error('Partial markdown table patch');
    for (const [before, after] of [...MARKDOWN_TABLE_EDITS].reverse()) source = source.replace(after, () => before);
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
