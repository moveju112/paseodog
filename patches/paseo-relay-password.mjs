// 릴레이 주소 발급·접속에서 비밀번호를 요구하는 검토된 웹 번들 패치.
const pairDeviceBefore = 'e.PairDeviceSection=function({serverId:e,onClose:t}){const{t:o}=(0,y.useTranslation)(),d=(0,w.useHostRuntimeClient)(e),f=(0,w.useHostRuntimeSnapshot)(e),p="online"===f?.connectionStatus,h="offline"===f?.connectionStatus||"error"===f?.connectionStatus,{patchConfig:b}=(0,S.useDaemonConfig)(e),[x,v]=(0,s.useState)(!1),R=d?.getLastServerInfoMessage()?.features,T=!0===R?.daemonStatusRpc,z=T&&!0===R?.relayConfig,E=(0,j.useFetchQuery)({queryKey:(0,_.daemonPairingOfferQueryKey)(e),queryFn:async()=>{if(!d)throw new Error(o("workspace.terminal.hostDisconnected"));return d.getDaemonPairingOffer()},enabled:T&&Boolean(d&&p),dataShape:"value",staleTimeMs:3e5,retry:1}),q=(0,u.useMutation)({mutationFn:async()=>{if(!0!==d?.getLastServerInfoMessage()?.features?.relayConfig)throw new Error(o("pairing.device.updateRequired"));if(!await b({relay:{enabled:!0}}))throw new Error(o("workspace.terminal.hostDisconnected"));return E.refetch()}}),P=(0,j.useFetchQuery)({queryKey:["daemon-pairing-offer-qr",E.data?.url],queryFn:()=>c.toString(E.data?.url??"",{type:"svg",errorCorrectionLevel:"M",margin:1,width:480}),enabled:Boolean(E.data?.url),dataShape:"value",staleTimeMs:3e5}),k=(0,s.useCallback)(async()=>{E.data?.url&&(await l.setStringAsync(E.data.url),v(!0),setTimeout(()=>v(!1),2e3))},[E.data?.url]),D=(0,s.useCallback)(()=>{k()},[k]),M=(0,s.useCallback)(()=>{E.refetch()},[E]),V=(0,s.useCallback)(()=>{q.mutate()},[q]),O=(0,s.useMemo)(()=>P.data??null,[P.data]);return(0,C.jsx)(n.View,{testID:"pair-device-content",children:(0,C.jsx)(I,{isPending:T&&E.isPending,isDisconnected:h,error:E.error,offer:E.data,canConfigureRelay:z,enablePending:q.isPending,enableError:q.error,qrSvg:O,qrError:P.isError,copied:x,onRetry:M,onEnableRelay:V,onClose:t,onCopy:D})})}';
const pairDeviceAfter = `e.PairDeviceSection=function({serverId:serverId,onClose:onClose}){
const{t:translate}=(0,y.useTranslation)(),client=(0,w.useHostRuntimeClient)(serverId),snapshot=(0,w.useHostRuntimeSnapshot)(serverId),online="online"===snapshot?.connectionStatus,{patchConfig:patchConfig}=(0,S.useDaemonConfig)(serverId),[copied,setCopied]=(0,s.useState)(false),[password,setPassword]=(0,s.useState)(""),[resetKey,setResetKey]=(0,s.useState)(0),features=client?.getLastServerInfoMessage()?.features,supported=true===features?.relayPasswordAuth;
const status=(0,j.useFetchQuery)({queryKey:[...(0,_.daemonPairingOfferQueryKey)(serverId),"relay-password"],queryFn:()=>client.getDaemonPairingOffer(),enabled:true===features?.daemonStatusRpc&&online,dataShape:"value",staleTimeMs:3e5,retry:1});
const enable=(0,u.useMutation)({retry:false,mutationFn:async()=>{if(true!==features?.relayConfig)throw new Error(translate("pairing.device.updateRequired"));if(!await patchConfig({relay:{enabled:true}}))throw new Error(translate("workspace.terminal.hostDisconnected"));return status.refetch()}});
const issue=(0,u.useMutation)({retry:false,mutationFn:async()=>{if(!client||!supported)throw new Error(translate("pairing.device.updateRequired"));if(!password)throw new Error(translate("pairing.hostPassword.label"));return client.getDaemonPairingOffer({password:password})},onSuccess:()=>{setPassword("");setResetKey(key=>key+1)}}),offer=issue.data??status.data;
const qr=(0,j.useFetchQuery)({queryKey:["daemon-pairing-offer-qr",offer?.url],queryFn:()=>c.toString(offer?.url??"",{type:"svg",errorCorrectionLevel:"M",margin:1,width:480}),enabled:Boolean(offer?.url),dataShape:"value",staleTimeMs:3e5});
return(0,C.jsxs)(n.View,{testID:"pair-device-content",children:[offer?.relayEnabled&&!offer.url&&online?(0,C.jsxs)(n.View,{style:H.consent,children:[(0,C.jsx)(t.Text,{style:H.consentTitle,children:translate("pairing.hostPassword.label")}),(0,C.jsx)(R.EditingTextInput,{resetKey:"relay-password-"+resetKey,secureTextEntry:true,autoCapitalize:"none",autoCorrect:false,accessibilityLabel:translate("pairing.hostPassword.label"),testID:"pair-device-password",style:H.linkInput,onChangeText:setPassword,readOnly:issue.isPending}),(0,C.jsx)(b.Button,{onPress:()=>issue.mutate(),loading:issue.isPending,disabled:!password||!supported||issue.isPending,testID:"pair-device-generate",children:translate("pairing.device.generateLink",{defaultValue:"주소 발급"})}),!supported?(0,C.jsx)(h.Alert,{size:"sm",variant:"warning",description:translate("pairing.device.updateRequired")}):null,issue.error?(0,C.jsx)(h.Alert,{size:"sm",variant:"error",description:issue.error.message}):null]}):null,(0,C.jsx)(I,{isPending:true===features?.daemonStatusRpc&&status.isPending,isDisconnected:"offline"===snapshot?.connectionStatus||"error"===snapshot?.connectionStatus,error:status.error,offer:offer,canConfigureRelay:true===features?.relayConfig,enablePending:enable.isPending,enableError:enable.error,qrSvg:qr.data??null,qrError:qr.isError,copied:copied,onRetry:()=>status.refetch(),onEnableRelay:()=>enable.mutate(),onClose:onClose,onCopy:async()=>{if(offer?.url){await l.setStringAsync(offer.url);setCopied(true);setTimeout(()=>setCopied(false),2000)}}})]})}`;

// 이전 배포본(V1): 이미 패치된 설치본을 원본으로 되돌리는 경로로만 쓴다.
const RELAY_PASSWORD_WEB_EDITS_V1 = [
    ['testID:I,children:f}),u[7]=b', 'testID:I,children:p?f:null}),u[7]=b'],
    ['device:{loadingOffer:"Loading pairing offer...",',
        'device:{loadingOffer:"Loading pairing offer...",generateLink:"Generate link",passwordLabel:"Relay password (set on first use)",passwordRequired:"Enter the relay password.",passwordSecurity:"Connecting requires both the link and the relay password. Share them separately.",'],
    ['c("pairing.device.securityWarning")',
        'c("pairing.device.passwordSecurity",{defaultValue:"Connecting requires both the link and the relay password. Share them separately."})'],
    ['message:{type:"daemon.get_pairing_offer.request"},responseType:"daemon.get_pairing_offer.response"',
        'message:{type:"daemon.get_pairing_offer.request",...(e?.password!==void 0?{password:e.password}:{})},responseType:"daemon.get_pairing_offer.response"'],
    [pairDeviceBefore, pairDeviceAfter.replace('resetKey:"relay-password-"+resetKey', 'key:"relay-password-"+resetKey')],
    ['if(!e.offer.url){let e,o;return n[14]!==s?(e=s("pairing.device.unavailable"),n[14]=s,n[15]=e):e=n[15],n[16]!==e?(o=(0,C.jsx)(t.Text,{style:H.stateLine,children:e}),n[16]=e,n[17]=o):o=n[17],o}', 'if(!e.offer.url)return null;'],
    ['[O,$]=(0,l.useState)(""),[B,E]=(0,l.useState)(void 0!==s),[K,N]=',
        '[O,$]=(0,l.useState)(""),[B,E]=(0,l.useState)(!0),[K,N]='],
    ['W.current?.replaceText(""),$(""),E(!1),N()', 'W.current?.replaceText(""),$(""),E(!0),N()'],
    ['V.current.changeUrl(e)&&($(""),E(!1),N(),U(""))', 'V.current.changeUrl(e)&&($(""),E(!0),N(),U(""))'],
    ['try{A(!0),U("");const e=await z.submit(n,O||void 0)', 'try{if(!O){U(R("pairing.hostPassword.label"));return}A(!0),U("");const e=await z.submit(n,O)'],
];

// 번들 문자열 리터럴 표기 (비ASCII -> \uXXXX, 원본 번들과 같은 소문자 표기)
function bundleText(text) {
    return Array.from(text, (char) => {
        const code = char.codePointAt(0);
        if (code < 128) return char;
        return char.split('').map((unit) => '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    }).join('');
}

// 번들에 넣을 번역 키 목록을 객체 리터럴 조각으로 만든다.
function bundleKeys(keys) {
    return Object.entries(keys).map(([key, value]) => `${key}:"${bundleText(value)}",`).join('');
}

const EN_DEVICE_KEYS = bundleKeys({
    resetToggle: 'Forgot the password? Reset password and link',
    resetPasswordLabel: 'New relay password (8+ characters)',
    resetAndGenerate: 'Reset and generate link',
    cancelReset: 'Cancel reset',
    resetWarning: 'Every previous link and password stops working, relay devices disconnect, and the host restarts briefly.',
    resetDone: 'Password and link were reset. Reconnect other devices with the new link and password.',
});
const KO_LOADING = `device:{loadingOffer:"${bundleText('페어링 정보 불러오는 중...')}",`;
const KO_DEVICE_KEYS = bundleKeys({
    generateLink: '주소 발급',
    passwordLabel: '릴레이 비밀번호 (첫 발급 시 설정)',
    passwordRequired: '릴레이 비밀번호를 입력하세요.',
    passwordSecurity: '주소와 릴레이 비밀번호가 모두 있어야 연결할 수 있어요. 각각 따로 전달하세요.',
    resetToggle: '비밀번호를 잊으셨나요? 비밀번호·주소 재설정',
    resetPasswordLabel: '새 릴레이 비밀번호 (8자 이상)',
    resetAndGenerate: '재설정하고 주소 발급',
    cancelReset: '재설정 취소',
    resetWarning: '이전 주소와 비밀번호가 모두 무효가 되고, 릴레이로 연결된 기기가 끊기며 호스트가 잠시 재시작돼요.',
    resetDone: '비밀번호와 주소를 재설정했어요. 다른 기기는 새 주소와 비밀번호로 다시 연결하세요.',
});

// V2: 비밀번호·주소 재설정, 재시작 중 발급 주소 유지, 구 데몬용 경고 문구, 주소 입력창은 서버가 요구할 때만 차단.
const pairDeviceAfterV2 = `e.PairDeviceSection=function({serverId:serverId,onClose:onClose}){
const{t:translate}=(0,y.useTranslation)(),client=(0,w.useHostRuntimeClient)(serverId),snapshot=(0,w.useHostRuntimeSnapshot)(serverId),online="online"===snapshot?.connectionStatus,{patchConfig:patchConfig}=(0,S.useDaemonConfig)(serverId),[copied,setCopied]=(0,s.useState)(false),[password,setPassword]=(0,s.useState)(""),[resetKey,setResetKey]=(0,s.useState)(0),[resetMode,setResetMode]=(0,s.useState)(false),features=client?.getLastServerInfoMessage()?.features,supported=true===features?.relayPasswordAuth;
const status=(0,j.useFetchQuery)({queryKey:[...(0,_.daemonPairingOfferQueryKey)(serverId),"relay-password"],queryFn:()=>client.getDaemonPairingOffer(),enabled:true===features?.daemonStatusRpc&&online,dataShape:"value",staleTimeMs:3e5,retry:1});
const enable=(0,u.useMutation)({retry:false,mutationFn:async()=>{if(true!==features?.relayConfig)throw new Error(translate("pairing.device.updateRequired"));if(!await patchConfig({relay:{enabled:true}}))throw new Error(translate("workspace.terminal.hostDisconnected"));return status.refetch()}});
const issue=(0,u.useMutation)({retry:false,mutationFn:async reset=>{if(!client||!supported)throw new Error(translate("pairing.device.updateRequired"));if(!password)throw new Error(translate("pairing.device.passwordRequired"));return client.getDaemonPairingOffer({password:password,reset:reset})},onSuccess:()=>{setPassword("");setResetKey(key=>key+1);setResetMode(false)}}),offer=issue.data??status.data,issued=Boolean(issue.data?.url),wasReset=issued&&true===issue.variables;
const qr=(0,j.useFetchQuery)({queryKey:["daemon-pairing-offer-qr",offer?.url],queryFn:()=>c.toString(offer?.url??"",{type:"svg",errorCorrectionLevel:"M",margin:1,width:480}),enabled:Boolean(offer?.url),dataShape:"value",staleTimeMs:3e5});
const label=resetMode?translate("pairing.device.resetPasswordLabel"):translate("pairing.device.passwordLabel");
return(0,C.jsxs)(n.View,{testID:"pair-device-content",children:[offer?.relayEnabled&&!offer.url&&online?(0,C.jsxs)(n.View,{style:H.consent,children:[(0,C.jsx)(t.Text,{style:H.consentTitle,children:label}),resetMode?(0,C.jsx)(h.Alert,{size:"sm",variant:"warning",description:translate("pairing.device.resetWarning")}):null,(0,C.jsx)(R.EditingTextInput,{key:"relay-password-"+resetKey+"-"+(resetMode?"reset":"issue"),secureTextEntry:true,autoCapitalize:"none",autoCorrect:false,accessibilityLabel:label,testID:"pair-device-password",style:H.linkInput,onChangeText:setPassword,readOnly:issue.isPending}),(0,C.jsx)(b.Button,{onPress:()=>issue.mutate(resetMode),loading:issue.isPending,disabled:!password||!supported||issue.isPending,testID:"pair-device-generate",children:resetMode?translate("pairing.device.resetAndGenerate"):translate("pairing.device.generateLink")}),supported?(0,C.jsx)(b.Button,{variant:"ghost",size:"sm",onPress:()=>{issue.reset();setResetMode(mode=>!mode)},disabled:issue.isPending,testID:"pair-device-reset-toggle",children:resetMode?translate("pairing.device.cancelReset"):translate("pairing.device.resetToggle")}):null,!supported?(0,C.jsx)(h.Alert,{size:"sm",variant:"warning",description:translate("pairing.device.updateRequired")}):null,issue.error?(0,C.jsx)(h.Alert,{size:"sm",variant:"error",description:issue.error.message}):null]}):null,wasReset?(0,C.jsx)(h.Alert,{size:"sm",variant:"success",description:translate("pairing.device.resetDone")}):null,(0,C.jsx)(I,{isPending:true===features?.daemonStatusRpc&&status.isPending&&!issued,isDisconnected:("offline"===snapshot?.connectionStatus||"error"===snapshot?.connectionStatus)&&!issued,passwordProtected:supported,error:status.error,offer:offer,canConfigureRelay:true===features?.relayConfig,enablePending:enable.isPending,enableError:enable.error,qrSvg:qr.data??null,qrError:qr.isError,copied:copied,onRetry:()=>status.refetch(),onEnableRelay:()=>enable.mutate(),onClose:onClose,onCopy:async()=>{if(offer?.url){await l.setStringAsync(offer.url);setCopied(true);setTimeout(()=>setCopied(false),2000)}}})]})}`;

const V1_EN_DEVICE = RELAY_PASSWORD_WEB_EDITS_V1[1][1];
const RELAY_PASSWORD_WEB_EDITS_V2 = [
    RELAY_PASSWORD_WEB_EDITS_V1[0],
    [RELAY_PASSWORD_WEB_EDITS_V1[1][0], V1_EN_DEVICE + EN_DEVICE_KEYS],
    [KO_LOADING, KO_LOADING + KO_DEVICE_KEYS],
    ['c("pairing.device.securityWarning")',
        'c(!1===e.passwordProtected?"pairing.device.securityWarning":"pairing.device.passwordSecurity",{defaultValue:"Connecting requires both the link and the relay password. Share them separately."})'],
    ['message:{type:"daemon.get_pairing_offer.request"},responseType:"daemon.get_pairing_offer.response"',
        'message:{type:"daemon.get_pairing_offer.request",...(e?.password!==void 0?{password:e.password}:{}),...(e?.reset?{reset:!0}:{})},responseType:"daemon.get_pairing_offer.response"'],
    [pairDeviceBefore, pairDeviceAfterV2],
    // V1의 나머지 편집은 그대로 쓰되, 주소 입력창의 무조건 비밀번호 요구(V1 마지막 편집)는 뺀다.
    ...RELAY_PASSWORD_WEB_EDITS_V1.slice(5, -1),
];

// V3: 일반 동작은 주소 조회로 표시하고 주소 유지·암호 재설정 조건은 데스크톱 호버·모바일 탭 툴팁으로 설명한다.
const EN_LINK_HELP = bundleKeys({
    linkHelpLabel: 'About pairing links',
    linkHelp: 'Set a password on the first lookup. With the same daemon and settings, looking up the link again or restarting keeps it unchanged. Resetting the password changes the link too; after restart, the previous link and password no longer work.',
});
const KO_LINK_HELP = bundleKeys({
    linkHelpLabel: '페어링 주소 안내',
    linkHelp: '첫 조회 시 비밀번호를 설정해요. 같은 데몬·설정에서는 다시 조회하거나 재시작해도 주소가 같아요. 비밀번호 재설정 시 주소도 바뀌며, 재시작 후 기존 주소·비밀번호는 무효가 돼요.',
});
const pairDeviceAfterV3 = pairDeviceAfterV2
    .replace('const label=resetMode?', 'const relayTooltip=r(_d[23]);const label=resetMode?')
    .replace('children:[offer?.relayEnabled', 'children:[supported&&offer?.relayEnabled?(0,C.jsx)(n.View,{style:{alignItems:"flex-end",marginBottom:8},children:(0,C.jsxs)(relayTooltip.Tooltip,{enabledOnDesktop:true,enabledOnMobile:true,children:[(0,C.jsx)(relayTooltip.TooltipTrigger,{accessibilityRole:"button",accessibilityLabel:translate("pairing.device.linkHelpLabel"),testID:"pair-device-link-help",children:(0,C.jsx)(t.Text,{style:H.hint,children:translate("pairing.device.linkHelpLabel")})}),(0,C.jsx)(relayTooltip.TooltipContent,{side:"bottom",align:"end",offset:6,children:(0,C.jsx)(t.Text,{style:[H.consentTitle,{fontWeight:"normal",maxWidth:320,lineHeight:22.4}],children:translate("pairing.device.linkHelp")})})]})}):null,offer?.relayEnabled');
const pairDeviceDeps = '},5223,[897,898,455,36,234,146,4110,5224,1227,801,1219,56,855,4329,3220,3956,3221,3969,3795,4639,3762,3931,279]);';
export const RELAY_PASSWORD_WEB_EDITS = [
    ...RELAY_PASSWORD_WEB_EDITS_V2.map(([before, after]) => {
        if (before === pairDeviceBefore) return [before, pairDeviceAfterV3];
        if (before === RELAY_PASSWORD_WEB_EDITS_V1[1][0]) {
            return [before, after.replace('generateLink:"Generate link",', 'generateLink:"Look up link",') + EN_LINK_HELP];
        }
        if (before === KO_LOADING) {
            return [before, after
                .replace(bundleText('주소 발급'), bundleText('주소 조회'))
                .replace(bundleText('첫 발급 시 설정'), bundleText('첫 조회 시 설정')) + KO_LINK_HELP];
        }
        return [before, after];
    }),
    [pairDeviceDeps, pairDeviceDeps.replace(',279]);', ',279,3942]);')],
];

// 전체 번들 해시 검증 전에 현재(V3)와 이전(V2·V1) 패치를 모두 되돌린다.
export function withoutRelayPassword(source) {
    const unwrap = (text, edits) => [...edits].reverse().reduce((value, [before, after]) => value.replace(after, () => before), text);
    return unwrap(unwrap(unwrap(source, RELAY_PASSWORD_WEB_EDITS), RELAY_PASSWORD_WEB_EDITS_V2), RELAY_PASSWORD_WEB_EDITS_V1);
}

// 검토된 앵커 하나씩만 바꾸고 부분 적용은 거부한다.
export function withRelayPassword(source) {
    return RELAY_PASSWORD_WEB_EDITS.reduce((text, [before, after]) => {
        if (text.split(before).length !== 2) throw new Error('Paseo relay password web anchor mismatch');
        return text.replace(before, () => after);
    }, source);
}
