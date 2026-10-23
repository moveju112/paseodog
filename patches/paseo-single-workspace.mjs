// 전체 번들 버전·blob 검증은 composer가 담당한다. 컴파일러 캐시에도 새 모드를 반영한다.
export const SINGLE_WORKSPACE_EDITS = [
    ['n.z.enum(["project","status","label"])', 'n.z.enum(["project","status","single","label"])'],
    ['groupMode:"status"===l.groupMode?"status":"project"',
        'groupMode:"label"===l.groupMode?"project":l.groupMode??"project"'],
    ['H={project:(0,o.withUnistyles)(c.Folder),status:(0,o.withUnistyles)(c.CircleDashed)}',
        'H={project:(0,o.withUnistyles)(c.Folder),status:(0,o.withUnistyles)(c.CircleDashed),single:(0,o.withUnistyles)(c.Folder)}'],
    ['G=["project","status"]', 'G=["project","single","status"]'],
    ['W={project:"sidebar.display.grouping.project",status:"sidebar.display.grouping.status"}',
        'W={project:"sidebar.display.grouping.project",status:"sidebar.display.grouping.status",single:"sidebar.display.grouping.single"}'],
    ['e.buildSidebarProjectRowModel=function(n){return{kind:"project_section"',
        'e.buildSidebarProjectRowModel=function(n){const[t]=n.project.workspaces;if(n.singleWorkspaceMode&&1===n.project.workspaces.length&&t)return{kind:"workspace",workspace:t,chevron:null,trailingAction:{kind:"none"}};return{kind:"project_section"'],
    ['function dr(e){const o=(0,k.c)(83),{project:t',
        'function dr(e){const singleWorkspaceMode=(0,r(4072).useSidebarViewStore)(e=>"single"===e.groupMode),o=(0,k.c)(87),{project:t'],
    ['o[0]!==s||o[1]!==t||o[2]!==H?(V=(0,pe.buildSidebarProjectRowModel)({project:t,collapsed:s,supportsMultiplicityByServerId:H}),o[0]=s',
        'o[83]!==singleWorkspaceMode||o[0]!==s||o[1]!==t||o[2]!==H?(V=(0,pe.buildSidebarProjectRowModel)({project:t,collapsed:s,singleWorkspaceMode,supportsMultiplicityByServerId:H}),o[83]=singleWorkspaceMode,o[0]=s'],
    ['const F=V;let z;o[4]!==s||o[5]!==t.workspaces?(z={workspaces:t.workspaces,enabled:s},o[4]=s',
        'const F=V;let z;o[84]!==F||o[4]!==s||o[5]!==t.workspaces?(z={workspaces:t.workspaces,enabled:s||"workspace"===F.kind},o[84]=F,o[4]=s'],
    ['const de=ce;let le;o[34]!==y||o[35]!==t.viewKey?(le=()=>{y(t.viewKey)},o[34]=y',
        'const de=ce;let le;o[85]!==F||o[86]!==P||o[34]!==y||o[35]!==t.viewKey?(le=()=>{if("workspace"===F.kind){P?.();(0,r(d[14]).navigateToWorkspace)({serverId:F.workspace.serverId,workspaceId:F.workspace.workspaceId});return}y(t.viewKey)},o[85]=F,o[86]=P,o[34]=y'],
    ['const ue=le;let ge=null;if(!s)if(t.workspaces.length>0)',
        'const ue=le;let ge=null;if(!s&&"workspace"!==F.kind)if(t.workspaces.length>0)'],
    ['statusBucket:U,selected:!1,chevron:F.chevron,onPress:ue',
        'statusBucket:U,selected:"workspace"===F.kind&&J,chevron:F.chevron,onPress:ue'],
    ['oe="project"!==v?(0,Se.jsx)(jr,', 'oe="status"===v?(0,Se.jsx)(jr,'],
    ['"project"===s.groupMode?k.push(...c.unpinnedProjects.map(o=>({workspaces:o.workspaces,collapsed:s.collapsedProjectKeys.has(o.viewKey)})))',
        '"status"!==s.groupMode?k.push(...c.unpinnedProjects.map(o=>({workspaces:o.workspaces,collapsed:!("single"===s.groupMode&&1===o.workspaces.length)&&s.collapsedProjectKeys.has(o.viewKey)})))'],
    ['switch(o.groupMode){case"project":return[];', 'switch(o.groupMode){case"project":case"single":return[];'],
];

const labels = [
    [String.raw`\u0627\u0644\u062a\u062c\u0645\u064a\u0639`, 'مساحة عمل واحدة'],
    ['Grouping', 'Single workspace'],
    [String.raw`Agrupaci\xf3n`, 'Espacio de trabajo único'],
    ['Regroupement', 'Espace de travail unique'],
    [String.raw`\u30b0\u30eb\u30fc\u30d7\u5316`, '単一ワークスペース'],
    [String.raw`\uadf8\ub8f9\ud654`, '단일 워크스페이스'],
    ['Agrupamento', 'Espaço de trabalho único'],
    [String.raw`\u0413\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u043a\u0430`, 'Одно рабочее пространство'],
    [String.raw`\u5206\u7ec4`, '单一工作区'],
];
for (const [label, single] of labels) {
    const before = `grouping:{label:"${label}",`;
    SINGLE_WORKSPACE_EDITS.push([before, `${before}single:${JSON.stringify(single)},`]);
}

export function withSingleWorkspace(source) {
    for (const [before, after] of SINGLE_WORKSPACE_EDITS) {
        if (source.split(before).length !== 2 || source.includes(after))
            throw new Error('Paseo single workspace anchor mismatch');
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutSingleWorkspace(source) {
    const counts = SINGLE_WORKSPACE_EDITS.map(([, after]) => source.split(after).length - 1);
    if (counts.some((count) => count > 1)) throw new Error('Paseo single workspace drift');
    if (counts.includes(0) && counts.includes(1)) throw new Error('Partial Paseo single workspace patch');
    for (const [before, after] of [...SINGLE_WORKSPACE_EDITS].reverse())
        source = source.replace(after, () => before);
    return source;
}
