// 릴레이 주소 발급·접속에서 비밀번호를 요구하는 검토된 웹 번들 패치.
const pairDeviceBefore = 'e.PairDeviceSection=function({serverId:e,onClose:t}){const{t:o}=(0,y.useTranslation)(),d=(0,w.useHostRuntimeClient)(e),f=(0,w.useHostRuntimeSnapshot)(e),p="online"===f?.connectionStatus,h="offline"===f?.connectionStatus||"error"===f?.connectionStatus,{patchConfig:b}=(0,S.useDaemonConfig)(e),[x,v]=(0,s.useState)(!1),R=d?.getLastServerInfoMessage()?.features,T=!0===R?.daemonStatusRpc,z=T&&!0===R?.relayConfig,E=(0,j.useFetchQuery)({queryKey:(0,_.daemonPairingOfferQueryKey)(e),queryFn:async()=>{if(!d)throw new Error(o("workspace.terminal.hostDisconnected"));return d.getDaemonPairingOffer()},enabled:T&&Boolean(d&&p),dataShape:"value",staleTimeMs:3e5,retry:1}),q=(0,u.useMutation)({mutationFn:async()=>{if(!0!==d?.getLastServerInfoMessage()?.features?.relayConfig)throw new Error(o("pairing.device.updateRequired"));if(!await b({relay:{enabled:!0}}))throw new Error(o("workspace.terminal.hostDisconnected"));return E.refetch()}}),P=(0,j.useFetchQuery)({queryKey:["daemon-pairing-offer-qr",E.data?.url],queryFn:()=>c.toString(E.data?.url??"",{type:"svg",errorCorrectionLevel:"M",margin:1,width:480}),enabled:Boolean(E.data?.url),dataShape:"value",staleTimeMs:3e5}),k=(0,s.useCallback)(async()=>{E.data?.url&&(await l.setStringAsync(E.data.url),v(!0),setTimeout(()=>v(!1),2e3))},[E.data?.url]),D=(0,s.useCallback)(()=>{k()},[k]),M=(0,s.useCallback)(()=>{E.refetch()},[E]),V=(0,s.useCallback)(()=>{q.mutate()},[q]),O=(0,s.useMemo)(()=>P.data??null,[P.data]);return(0,C.jsx)(n.View,{testID:"pair-device-content",children:(0,C.jsx)(I,{isPending:T&&E.isPending,isDisconnected:h,error:E.error,offer:E.data,canConfigureRelay:z,enablePending:q.isPending,enableError:q.error,qrSvg:O,qrError:P.isError,copied:x,onRetry:M,onEnableRelay:V,onClose:t,onCopy:D})})}';
const pairDeviceAfter = `e.PairDeviceSection=function({serverId:serverId,onClose:onClose}){
const{t:translate}=(0,y.useTranslation)(),client=(0,w.useHostRuntimeClient)(serverId),snapshot=(0,w.useHostRuntimeSnapshot)(serverId),online="online"===snapshot?.connectionStatus,{patchConfig:patchConfig}=(0,S.useDaemonConfig)(serverId),[copied,setCopied]=(0,s.useState)(false),[password,setPassword]=(0,s.useState)(""),[resetKey,setResetKey]=(0,s.useState)(0),features=client?.getLastServerInfoMessage()?.features,supported=true===features?.relayPasswordAuth;
const status=(0,j.useFetchQuery)({queryKey:[...(0,_.daemonPairingOfferQueryKey)(serverId),"relay-password"],queryFn:()=>client.getDaemonPairingOffer(),enabled:true===features?.daemonStatusRpc&&online,dataShape:"value",staleTimeMs:3e5,retry:1});
const enable=(0,u.useMutation)({retry:false,mutationFn:async()=>{if(true!==features?.relayConfig)throw new Error(translate("pairing.device.updateRequired"));if(!await patchConfig({relay:{enabled:true}}))throw new Error(translate("workspace.terminal.hostDisconnected"));return status.refetch()}});
const issue=(0,u.useMutation)({retry:false,mutationFn:async()=>{if(!client||!supported)throw new Error(translate("pairing.device.updateRequired"));if(!password)throw new Error(translate("pairing.hostPassword.label"));return client.getDaemonPairingOffer({password:password})},onSuccess:()=>{setPassword("");setResetKey(key=>key+1)}}),offer=issue.data??status.data;
const qr=(0,j.useFetchQuery)({queryKey:["daemon-pairing-offer-qr",offer?.url],queryFn:()=>c.toString(offer?.url??"",{type:"svg",errorCorrectionLevel:"M",margin:1,width:480}),enabled:Boolean(offer?.url),dataShape:"value",staleTimeMs:3e5});
return(0,C.jsxs)(n.View,{testID:"pair-device-content",children:[offer?.relayEnabled&&!offer.url&&online?(0,C.jsxs)(n.View,{style:H.consent,children:[(0,C.jsx)(t.Text,{style:H.consentTitle,children:translate("pairing.hostPassword.label")}),(0,C.jsx)(R.EditingTextInput,{resetKey:"relay-password-"+resetKey,secureTextEntry:true,autoCapitalize:"none",autoCorrect:false,accessibilityLabel:translate("pairing.hostPassword.label"),testID:"pair-device-password",style:H.linkInput,onChangeText:setPassword,readOnly:issue.isPending}),(0,C.jsx)(b.Button,{onPress:()=>issue.mutate(),loading:issue.isPending,disabled:!password||!supported||issue.isPending,testID:"pair-device-generate",children:translate("pairing.device.generateLink",{defaultValue:"주소 발급"})}),!supported?(0,C.jsx)(h.Alert,{size:"sm",variant:"warning",description:translate("pairing.device.updateRequired")}):null,issue.error?(0,C.jsx)(h.Alert,{size:"sm",variant:"error",description:issue.error.message}):null]}):null,(0,C.jsx)(I,{isPending:true===features?.daemonStatusRpc&&status.isPending,isDisconnected:"offline"===snapshot?.connectionStatus||"error"===snapshot?.connectionStatus,error:status.error,offer:offer,canConfigureRelay:true===features?.relayConfig,enablePending:enable.isPending,enableError:enable.error,qrSvg:qr.data??null,qrError:qr.isError,copied:copied,onRetry:()=>status.refetch(),onEnableRelay:()=>enable.mutate(),onClose:onClose,onCopy:async()=>{if(offer?.url){await l.setStringAsync(offer.url);setCopied(true);setTimeout(()=>setCopied(false),2000)}}})]})}`;

export const RELAY_PASSWORD_WEB_EDITS = [
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

// 전체 번들 해시 검증 전에 이 패치만 되돌린다.
export function withoutRelayPassword(source) {
    return [...RELAY_PASSWORD_WEB_EDITS].reverse().reduce((text, [before, after]) => text.replace(after, () => before), source);
}

// 검토된 앵커 하나씩만 바꾸고 부분 적용은 거부한다.
export function withRelayPassword(source) {
    return RELAY_PASSWORD_WEB_EDITS.reduce((text, [before, after]) => {
        if (text.split(before).length !== 2) throw new Error('Paseo relay password web anchor mismatch');
        return text.replace(before, () => after);
    }, source);
}
