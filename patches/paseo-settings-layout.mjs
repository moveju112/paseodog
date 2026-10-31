import { readFileSync } from 'node:fs';

// 전체 원본 blob 검증 뒤에만 적용한다. UI 배치만 바꾸고 기존 콜백·저장 계약을 재사용한다.
const screen = readFileSync(new URL('../android/packages/app/src/screens/settings-screen.tsx', import.meta.url), 'utf8');
const hostItems = screen.match(/const HOST_SECTION_ITEMS: HostSectionItem\[\] = (\[[\s\S]*?\n\]);/)[1]
    .replace(/\bicon: (\w+)/g, 'icon:f.$1');
const previousHostItems = '[{id:"agents",labelKey:"settings.hostSections.agents",icon:f.Bot},{id:"engine-accounts",labelKey:"settings.hostSections.engineAccounts",icon:f.KeyRound},{id:"engine-workflow",labelKey:"settings.hostSections.engineWorkflow",icon:f.Workflow},{id:"engine-tokens",labelKey:"settings.hostSections.engineTokens",icon:f.Sparkles},{id:"engine-instructions",labelKey:"settings.hostSections.engineInstructions",icon:f.FileText},{id:"engine-tools",labelKey:"settings.hostSections.engineTools",icon:f.Puzzle},{id:"engine-skills",labelKey:"settings.hostSections.engineSkills",icon:f.Bot},{id:"host",labelKey:"settings.hostSections.host",icon:f.Server},{id:"projects",labelKey:"settings.hostSections.projects",icon:f.FolderGit2},{id:"workspaces",labelKey:"settings.hostSections.workspaces",icon:f.FolderGit2},{id:"usage",labelKey:"settings.hostSections.usage",icon:f.Gauge},{id:"terminals",labelKey:"settings.hostSections.terminals",icon:f.SquareTerminal},{id:"connections",labelKey:"settings.hostSections.connections",icon:f.Network},{id:"pair-device",labelKey:"openProject.tiles.pairDevice.title",icon:f.Smartphone}]';

const engineLayout = `
function paseodogWorkflowSection(props,content){
    const [rules,basic,agents,orchestration,profile,execution,rulesEditor,searchEditor,agentEditor]=content.props.children;
    const [basicHint,basicCard]=basic.props.children;
    const [search,roles]=basicCard.props.children;
    const profileCard=profile.props.children;
    const profileRows=profileCard.props.children;
    switch(props.section){
        case "workflow":return u.createElement(u.Fragment,null,rules,u.createElement(paseodogOrchestration,{...orchestration.props,disabled:props.disabled}),rulesEditor);
        case "agents":return u.createElement(u.Fragment,null,u.cloneElement(basic,{},basicHint,u.cloneElement(basicCard,{},roles)),u.cloneElement(agents,{title:"하위 에이전트"}),agentEditor);
        case "tools":return u.createElement(u.Fragment,null,u.cloneElement(basic,{title:"웹 검색 모델"},u.cloneElement(basicCard,{},search)),searchEditor);
        case "response":return u.cloneElement(profile,{},u.cloneElement(profileCard,{},...profileRows.slice(0,3)));
        case "generation":return u.cloneElement(profile,{title:"세션 제목"},u.cloneElement(profileCard,{},profileRows[3]));
        case "execution":return execution;
    }
}
function paseodogOrchestration(props){
    return u.createElement(b.SettingsSection,{title:"자동 오케스트레이터 (Orchestration)"},
        u.createElement(n.View,{style:[S.settingsStyles.card,B.panel]},
            u.createElement(D,{title:"오케스트레이션 모드",value:props.mode,options:k,disabled:props.disabled,onChange:mode=>props.request({action:"orchestration",mode})}),
            u.createElement(o.Text,{style:S.settingsStyles.rowHint},V[props.mode])));
}
function paseodogToolsSection(props){
    const content=Q(props),card=content.props.children;
    const [web,memory,modules,installs]=card.props.children;
    if(props.scope==="memory"){
        const recap=u.createElement(I,{title:"백그라운드 메모리 (Recap)",hint:"백그라운드 메모리 정리·요약 사이클을 사용"},
            u.createElement(w.Switch,{accessibilityLabel:"백그라운드 메모리",disabled:props.disabled,value:props.snapshot.recap??true,
                onValueChange:recap=>props.request({action:"features",recap})}));
        return u.cloneElement(content,{title:"메모리"},u.cloneElement(card,{},memory,recap));
    }
    const local=props.scope==="providers";
    return u.cloneElement(content,{title:local?"로컬 모델 확장":content.props.title},u.cloneElement(card,{},
        local?null:web,...modules.filter(row=>(row.key==="localProvider")===local),
        ...installs.filter(row=>(row.key==="install-localProvider")===local)));
}
`;
const sectionBody = `function Se(t){switch(t.section){
case"workflow":case"agents":case"response":case"execution":case"generation":return u.createElement(ie,t);
case"tools":return u.createElement(u.Fragment,null,u.createElement(paseodogToolsSection,t),u.createElement(ie,t));
case"memory":case"providers":return u.createElement(paseodogToolsSection,{...t,scope:t.section});
default:return paseodogPreviousSectionBody(t);
}}function paseodogPreviousSectionBody(t){`;
const hostContent = `function Re(e,t){
const page=section=>c.createElement(xe.AiEnginePage,{key:e.serverId+":"+section,serverId:e.serverId,section});
const base=()=>paseodogPreviousHostContent(e,t);
switch(e.section){
case"engine-response":return page("response");
case"engine-execution":return page("execution");
case"engine-speech":return page("speech");
case"engine-memory":return page("memory");
case"engine-agents":case"agents":return c.createElement(c.Fragment,null,page("agents"),c.createElement(pe.HostAgentsPage,{serverId:e.serverId}));
case"engine-tools":return c.createElement(c.Fragment,null,base(),c.createElement(pe.HostToolsSection,{serverId:e.serverId}));
case"engine-skills":return c.createElement(c.Fragment,null,base(),c.createElement(pe.HostSkillsSection,{serverId:e.serverId}));
case"engine-instructions":return c.createElement(c.Fragment,null,base(),c.createElement(T.SettingsSection,{title:"공통 시스템 프롬프트"},c.createElement(pe.AppendSystemPromptCard,{serverId:e.serverId})));
case"metadata":return c.createElement(c.Fragment,null,page("generation"),base());
case"providers":return c.createElement(c.Fragment,null,page("providers"),base());
default:return base();
}}function paseodogPreviousHostContent(e,t){switch(e.section)`;
const chatLayout = `function paseodogChatLayout(content,translate){
const section=content.props.children,card=section.props.children,rows=card.props.children;
return u.jsxs(t.View,{children:[
u.jsx(s.SettingsSection,{title:translate("settings.chat.profile"),children:u.jsx(s.SettingsCard,{children:rows.slice(0,2)})}),
u.jsx(s.SettingsSection,{title:translate("settings.chat.display"),children:u.jsx(s.SettingsCard,{children:rows.slice(2)})}),
u.jsx(r(5305).SendingSection,{})]});
}`;
const usageSection = `e.UsagePreferencesSection=function(){return(0,D.jsx)(y.SettingsSection,{title:C.usageCopy.options,children:(0,D.jsx)(y.SettingsCard,{children:(0,D.jsx)(e.UsageOptions,{inline:true})})})};`;

const edits = [
    ['const Ae=' + previousHostItems, 'const Ae=' + hostItems],
    ['"mixdog-agents":{section:"workflow",hostSection:"engine-workflow"}', '"mixdog-agents":{section:"agents",hostSection:"agents"}'],
    ['function Re(e,t){switch(e.section)', hostContent],
    ['const U=["engine-accounts","engine-workflow",', 'const U=["engine-response","engine-execution","engine-speech","engine-memory","engine-accounts","engine-workflow",'],
    ['normalizeHostSectionSlug=function(t){if(C(t))', 'normalizeHostSectionSlug=function(t){if(t==="engine-agents")return"agents";if(C(t))'],
    ['e.section==="workflow"?u.createElement(PaseodogSpeechSettings', 'e.section==="speech"?u.createElement(PaseodogSpeechSettings'],
    ['e.section==="workflow"?u.createElement(PaseodogTurnDurationSettings', 'e.section==="execution"?u.createElement(PaseodogTurnDurationSettings'],
    ['u.createElement(PaseodogBaseAiEnginePage,e),', 'e.section==="speech"?null:u.createElement(PaseodogBaseAiEnginePage,{...e,key:e.serverId+":"+e.section}),'],
    ['function ie(e){const t=(0,c.c)(471)', engineLayout + 'function ie(e){const t=(0,c.c)(471)'],
    ['t[470]=ei):ei=t[470],ei}', 't[470]=ei):ei=t[470],paseodogWorkflowSection(e,ei)}'],
    ['function Se(t){const l=(0,c.c)(13)', sectionBody + 'const l=(0,c.c)(13)'],
    ['children:[le,ie,ne,ae,ce,ue,me,ge]', 'children:[le,ie,ne,ae,ce,ue,me]'],
    ['children:[f,y,S]}),n[8]=f,n[9]=y,n[10]=S,n[11]=j)', 'children:[p?null:f,S]}),n[8]=f,n[9]=y,n[10]=S,n[11]=j)'],
    ['function De(e){const n=(0,o.c)(22)', `_e.HostToolsSection=e=>c.createElement(B.SettingsSection,{title:"Paseo 도구·브라우저 연동"},c.createElement(De,e),c.createElement(G.BrowserToolsOptInCard,e));_e.HostSkillsSection=e=>c.createElement(v.AgentSkillsSection,e);_e.AppendSystemPromptCard=He;function De(e){const n=(0,o.c)(22)`],
    ['children:[(0,Pe.jsx)(Ee,{settings:f,handleLanguageChange:pe}),(0,Pe.jsx)(D.SendingSection,{}),q?(0,Pe.jsx)(H.OpenLocationSection,{}):null]',
        'children:[(0,Pe.jsx)(Ee,{settings:f,handleLanguageChange:pe})]'],
    ['return st};var', 'return r(36).createElement(r(36).Fragment,null,st,r(883).isElectronRuntime()?r(36).createElement(r(5301).OpenLocationSection):null)};var'],
    ['h[39]=T):T=h[39];return T}', 'h[39]=T):T=h[39];return paseodogChatLayout(T,v)};' + chatLayout],
    ['e.SidebarNavSection=function(){const t=(0,n.c)(1)', 'e.SidebarNavSection=function(){return r(36).createElement(r(36).Fragment,null,r(36).createElement(paseodogPreviousSidebar),r(36).createElement(r(4410).UsagePreferencesSection))};function paseodogPreviousSidebar(){const t=(0,n.c)(1)'],
    ['e.UsageOptions=function(){const n=(0,t.c)(19)', 'e.UsageOptions=function(props){const n=(0,t.c)(19)'],
    ['n[18]=P):P=n[18];return P};', 'n[18]=P):P=n[18];return props?.inline?r(36).cloneElement(z.props.children,{},...z.props.children.props.children.slice(1)):P};' + usageSection],
    ['case"diagnostics":return(0,Pe.jsx)(Me,{', 'case"diagnostics":return c.createElement(c.Fragment,null,c.createElement(paseodogDiagnosticTarget,{serverId:ge}),c.createElement(Me,{'],
    ['handlePlaybackTest:Se,serverId:ge});case"about"', 'handlePlaybackTest:Se,serverId:ge}));case"about"'],
    ['function Me(e){const section=PaseodogBaseDiagnostics(e)', `function paseodogDiagnosticTarget({serverId}){const hosts=L.useHosts(),{t}=S.useTranslation();return c.createElement(s.Text,{style:ae.settingsStyles.rowHint,testID:"diagnostic-host-target"},t("settings.diagnosticTarget",{host:hosts.find(host=>host.serverId===serverId)?.label??t("settings.noDiagnosticHost")}))}function Me(e){const section=PaseodogBaseDiagnostics(e)`],
];

// 번역 리소스의 문자열 객체를 그대로 사용해 앱·웹 메뉴 이름이 갈라지지 않게 한다.
function settingsCopy(locale) {
    const text = readFileSync(new URL(`../android/packages/app/src/i18n/resources/${locale}.ts`, import.meta.url), 'utf8');
    const strings = block => Object.fromEntries([...block.matchAll(/(\w+): ("(?:[^"\\]|\\.)*"),/g)]
        .map(([, key, value]) => [key, JSON.parse(value)]));
    return {
        hostSections: strings(text.match(/\n    hostSections: \{([\s\S]*?)\n    \},/)[1]),
        chat: strings(text.match(/\n    chat: \{\n      profile:([\s\S]*?)\n    \},/)[0]),
        diagnosticTarget: JSON.parse(text.match(/\n    diagnosticTarget:\s*("(?:[^"\\]|\\.)*"),/)[1]),
        noDiagnosticHost: JSON.parse(text.match(/\n    noDiagnosticHost:\s*("(?:[^"\\]|\\.)*"),/)[1]),
    };
}
for (const [locale, variable, tail, terminal] of [
    ['en', 't', '},3119,[]);', 'Terminal display'],
    ['ko', 'n', '},3124,[3119,3120]);', '터미널 표시'],
]) {
    const copy = settingsCopy(locale);
    edits.push([tail, `;Object.assign(${variable}.settings,${JSON.stringify(copy)});${variable}.settings.sections.terminal=${JSON.stringify(terminal)};${tail}`]);
}

export function withSettingsLayout(source) {
    for (const [before, after] of edits) {
        if (source.split(before).length !== 2)
            throw new Error(`Settings layout anchor mismatch: ${before.slice(0, 100)}`);
        source = source.replace(before, () => after);
    }
    return source;
}

export function withoutSettingsLayout(source) {
    for (const [before, after] of [...edits].reverse()) source = source.replace(after, () => before);
    return source;
}
