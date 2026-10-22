import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { PairLinkModal } from "@/components/pair-link-modal";
import { getHostRuntimeStore, type PasswordRequiredPairing } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";

// 링크 수신 -> 비밀번호 입력·사용자 확인 -> 연결 성공 후 이동. 제출 전에는 호스트를 저장하거나 연결하지 않는다.
export function OfferLinkListener() {
  const router = useRouter();
  const [pending, setPending] = useState<PasswordRequiredPairing | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 최초 링크와 실행 중 받은 링크를 같은 입력창으로 넘긴다.
    const handleUrl = (url: string | null) => {
      if (cancelled || !url) return;
      if (!url.includes("#offer=") && !url.includes("#connect=") && !url.startsWith("relay://"))
        return;
      setPending({ link: url, pairing: getHostRuntimeStore().beginLinkPairing() });
    };
    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => handleUrl(event.url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // 취소는 입력창만 닫고 성공한 연결만 프로젝트 선택 화면으로 이동한다.
  const close = useCallback(() => setPending(null), []);
  const saved = useCallback(() => {
    setPending(null);
    router.replace(buildOpenProjectRoute());
  }, [router]);

  return pending ? (
    <PairLinkModal visible passwordRequired={pending} onClose={close} onSaved={saved} />
  ) : null;
}
