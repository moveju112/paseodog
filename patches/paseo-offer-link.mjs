// 링크 진입 시 기존 비밀번호 입력창을 먼저 보여 준다. 모듈 5268은 검토된 번들의 PairLinkModal이다.
export const OFFER_LINK_BEFORE = 'function Pt(){const e=(0,h.useRouter)();return(0,f.useEffect)(()=>{let t=!1;const n=async n=>{if(n&&(n.includes("#offer=")||n.includes("#connect=")||n.startsWith("relay://")))try{const o=await(0,We.getHostRuntimeStore)().importConnectionLink(n,"openProject");t||"connected"!==o.status||e.replace((0,Be.buildOpenProjectRoute)())}catch(e){console.warn("[OfferLinkListener] Pairing link failed",e)}};u.getInitialURL().then(e=>n(e)).catch(()=>{});const o=u.addEventListener("url",e=>{n(e.url)});return()=>{t=!0,o.remove()}},[e]),null}';
export const OFFER_LINK_AFTER = `function Pt(){
const router=(0,h.useRouter)(),[pending,setPending]=(0,f.useState)(null);
(0,f.useEffect)(()=>{let cancelled=false;
const handleUrl=url=>{if(cancelled||!url)return;if(!url.includes("#offer=")&&!url.includes("#connect=")&&!url.startsWith("relay://"))return;
setPending({link:url,pairing:(0,We.getHostRuntimeStore)().beginLinkPairing()})};
u.getInitialURL().then(handleUrl).catch(()=>{});const subscription=u.addEventListener("url",event=>handleUrl(event.url));
return()=>{cancelled=true;subscription.remove()}},[]);
return pending?(0,Ue.jsx)(r(5268).PairLinkModal,{visible:true,passwordRequired:pending,onClose:()=>setPending(null),
onSaved:()=>{setPending(null);router.replace((0,Be.buildOpenProjectRoute)())}}):null}`;

// 전체 번들 해시 검사 전에 링크 리스너 패치를 되돌린다.
export function withoutOfferLink(source) {
    return source.replace(OFFER_LINK_AFTER, () => OFFER_LINK_BEFORE);
}

// 검토된 리스너 하나에만 적용하고 중복·부분 적용을 거부한다.
export function withOfferLink(source) {
    if (source.split(OFFER_LINK_BEFORE).length !== 2) throw new Error('Paseo offer link anchor mismatch');
    return source.replace(OFFER_LINK_BEFORE, () => OFFER_LINK_AFTER);
}
