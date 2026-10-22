import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { SvgXml } from "react-native-svg";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Network, RotateCw, ShieldCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";

const RELAY_DOCS_URL = "https://paseo.sh/docs/security";
const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const ThemedNetwork = withUnistyles(Network);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const accentBrightColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

export interface PairDeviceSectionProps {
  serverId: string;
  onClose: () => void;
}

export function PairDeviceSection({ serverId, onClose }: PairDeviceSectionProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = runtimeSnapshot?.connectionStatus === "online";
  const isDisconnected =
    runtimeSnapshot?.connectionStatus === "offline" ||
    runtimeSnapshot?.connectionStatus === "error";
  const { patchConfig } = useDaemonConfig(serverId);
  const [copied, setCopied] = useState(false);
  const serverFeatures = client?.getLastServerInfoMessage()?.features;
  const supportsPairingRpc = serverFeatures?.daemonStatusRpc === true;
  const canConfigureRelay = supportsPairingRpc && serverFeatures?.relayConfig === true;
  const supportsRelayPassword = serverFeatures?.relayPasswordAuth === true;

  const pairingQuery = useFetchQuery({
    queryKey: daemonPairingOfferQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getDaemonPairingOffer();
    },
    enabled: supportsPairingRpc && Boolean(client && isConnected),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
  });

  const enableRelay = useMutation({
    retry: false,
    mutationFn: async () => {
      if (client?.getLastServerInfoMessage()?.features?.relayConfig !== true) {
        throw new Error(t("pairing.device.updateRequired"));
      }
      const config = await patchConfig({ relay: { enabled: true } });
      if (!config) throw new Error(t("workspace.terminal.hostDisconnected"));
      return pairingQuery.refetch();
    },
  });

  const relayIssue = useRelayPasswordIssue(client, supportsRelayPassword);
  const offer = relayIssue.issuedOffer ?? pairingQuery.data;
  // 발급한 주소는 재설정 재시작으로 연결이 잠시 끊겨도 계속 보여 준다.
  const hasIssuedLink = Boolean(relayIssue.issuedOffer?.url);

  const qrQuery = useFetchQuery({
    queryKey: ["daemon-pairing-offer-qr", offer?.url],
    queryFn: () =>
      QRCode.toString(offer?.url ?? "", {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: Boolean(offer?.url),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
  });

  const handleCopyLink = useCallback(async () => {
    if (!offer?.url) return;
    await Clipboard.setStringAsync(offer.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [offer?.url]);
  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);
  const handleRetry = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);
  const handleEnableRelay = useCallback(() => {
    enableRelay.mutate();
  }, [enableRelay]);

  const qrSvg = useMemo(() => qrQuery.data ?? null, [qrQuery.data]);

  return (
    <View testID="pair-device-content">
      <RelayPasswordForm
        offer={offer}
        connected={isConnected}
        supported={supportsRelayPassword}
        password={relayIssue.password}
        resetKey={relayIssue.resetKey}
        pending={relayIssue.pending}
        error={relayIssue.error}
        resetMode={relayIssue.resetMode}
        onPasswordChange={relayIssue.setPassword}
        onGenerate={relayIssue.generate}
        onToggleReset={relayIssue.toggleReset}
      />
      <RelayResetDone visible={relayIssue.wasReset} />
      <PairDeviceBody
        isPending={supportsPairingRpc && pairingQuery.isPending}
        isDisconnected={isDisconnected}
        hasIssuedLink={hasIssuedLink}
        passwordProtected={supportsRelayPassword}
        error={pairingQuery.error}
        offer={offer}
        canConfigureRelay={canConfigureRelay}
        enablePending={enableRelay.isPending}
        enableError={enableRelay.error}
        qrSvg={qrSvg}
        qrError={qrQuery.isError}
        copied={copied}
        onRetry={handleRetry}
        onEnableRelay={handleEnableRelay}
        onClose={onClose}
        onCopy={handleCopyPress}
      />
    </View>
  );
}

// 릴레이 암호로 주소 발급·재설정 (입력 암호 -> 발급 요청 -> 성공 시 입력 초기화·재설정 모드 해제)
function useRelayPasswordIssue(
  client: ReturnType<typeof useHostRuntimeClient>,
  supported: boolean,
) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [resetMode, setResetMode] = useState(false);
  const issueOffer = useMutation({
    retry: false,
    mutationFn: async (reset: boolean) => {
      if (!client || !supported) throw new Error(t("pairing.device.updateRequired"));
      if (!password) throw new Error(t("pairing.device.passwordRequired"));
      return client.getDaemonPairingOffer({ password, reset });
    },
    onSuccess: () => {
      setPassword("");
      setResetKey((key) => key + 1);
      setResetMode(false);
    },
  });
  const generate = useCallback(() => {
    issueOffer.mutate(resetMode);
  }, [issueOffer, resetMode]);
  const toggleReset = useCallback(() => {
    issueOffer.reset();
    setResetMode((current) => !current);
  }, [issueOffer]);
  return {
    password,
    setPassword,
    resetKey,
    resetMode,
    generate,
    toggleReset,
    pending: issueOffer.isPending,
    error: issueOffer.error,
    issuedOffer: issueOffer.data,
    wasReset: Boolean(issueOffer.data?.url) && issueOffer.variables === true,
  };
}

interface RelayPasswordFormProps {
  offer: { relayEnabled: boolean; url: string } | undefined;
  connected: boolean;
  supported: boolean;
  password: string;
  resetKey: number;
  pending: boolean;
  error: Error | null;
  resetMode: boolean;
  onPasswordChange: (password: string) => void;
  onGenerate: () => void;
  onToggleReset: () => void;
}

// 주소가 없는 릴레이에서만 암호 입력·발급·재설정·검증 오류를 표시한다.
function RelayPasswordForm(props: RelayPasswordFormProps) {
  const { t } = useTranslation();
  if (!props.offer?.relayEnabled || props.offer.url || !props.connected) return null;
  const label = props.resetMode
    ? t("pairing.device.resetPasswordLabel")
    : t("pairing.device.passwordLabel");
  return (
    <View style={styles.consent}>
      <Text style={styles.consentTitle}>{label}</Text>
      {props.resetMode ? (
        <Alert size="sm" variant="warning" description={t("pairing.device.resetWarning")} />
      ) : null}
      <TextInput
        key={`relay-password-${props.resetKey}-${props.resetMode ? "reset" : "issue"}`}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        testID="pair-device-password"
        style={styles.linkInput}
        onChangeText={props.onPasswordChange}
        readOnly={props.pending}
      />
      <Button
        onPress={props.onGenerate}
        loading={props.pending}
        disabled={!props.password || !props.supported || props.pending}
        testID="pair-device-generate"
      >
        {props.resetMode ? t("pairing.device.resetAndGenerate") : t("pairing.device.generateLink")}
      </Button>
      {props.supported ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={props.onToggleReset}
          disabled={props.pending}
          testID="pair-device-reset-toggle"
        >
          {props.resetMode ? t("pairing.device.cancelReset") : t("pairing.device.resetToggle")}
        </Button>
      ) : null}
      {!props.supported ? (
        <Alert size="sm" variant="warning" description={t("pairing.device.updateRequired")} />
      ) : null}
      {props.error ? <Alert size="sm" variant="error" description={props.error.message} /> : null}
    </View>
  );
}

// 재설정 완료 안내 (다른 기기 재연결 필요)
function RelayResetDone({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return <Alert size="sm" variant="success" description={t("pairing.device.resetDone")} />;
}

interface PairDeviceBodyProps {
  isPending: boolean;
  isDisconnected: boolean;
  hasIssuedLink: boolean;
  passwordProtected: boolean;
  error: Error | null;
  offer: { relayEnabled: boolean; url: string } | undefined;
  canConfigureRelay: boolean;
  enablePending: boolean;
  enableError: Error | null;
  qrSvg: string | null;
  qrError: boolean;
  copied: boolean;
  onRetry: () => void;
  onEnableRelay: () => void;
  onClose: () => void;
  onCopy: () => void;
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  if (props.isDisconnected && !props.hasIssuedLink) {
    return (
      <OfferLoadError message={t("workspace.terminal.hostDisconnected")} onRetry={props.onRetry} />
    );
  }
  if (props.isPending && !props.hasIssuedLink) {
    return <Text style={styles.stateLine}>{t("pairing.device.loadingOffer")}</Text>;
  }
  if (props.error) {
    return <OfferLoadError message={props.error.message} onRetry={props.onRetry} />;
  }
  if (!props.offer?.relayEnabled) {
    return <RelayConsent {...props} />;
  }
  if (!props.offer.url) {
    return null;
  }
  return <PairingOffer {...props} offer={props.offer} />;
}

function OfferLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert size="sm" variant="error" description={message}>
      <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={onRetry}>
        {t("pairing.device.retry")}
      </Button>
    </Alert>
  );
}

function RelayConsent(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  let enableButtonLabel = t("pairing.device.enableRelay");
  if (props.enablePending) {
    enableButtonLabel = t("pairing.device.enablingRelay");
  } else if (props.enableError) {
    enableButtonLabel = t("pairing.device.retry");
  }
  return (
    <View style={styles.consent}>
      <View style={styles.hero}>
        <RelayHeroBadge />
        <Text style={styles.consentTitle}>{t("pairing.device.enableTitle")}</Text>
        <Text style={styles.consentDescription}>{t("pairing.device.enableDescription")}</Text>
        <ExternalLink
          href={RELAY_DOCS_URL}
          label={t("pairing.device.relayDocs")}
          accessibilityLabel={t("pairing.device.relayDocsAccessibility")}
        />
      </View>
      {props.enableError ? (
        <Alert size="sm" variant="error" description={props.enableError.message} />
      ) : null}
      {!props.canConfigureRelay ? (
        <Alert size="sm" variant="warning" description={t("pairing.device.updateRequired")} />
      ) : null}
      <View style={styles.actions}>
        <Button variant="secondary" style={FLEX_ONE_STYLE} onPress={props.onClose}>
          {t("pairing.device.notNow")}
        </Button>
        {props.canConfigureRelay ? (
          <Button
            variant="default"
            style={FLEX_ONE_STYLE}
            loading={props.enablePending}
            onPress={props.onEnableRelay}
          >
            {enableButtonLabel}
          </Button>
        ) : null}
      </View>
      <View style={styles.directRow}>
        <ThemedNetwork size={14} style={styles.directIcon} />
        <Text style={styles.directHint}>{t("pairing.device.directConnectionHint")}</Text>
      </View>
    </View>
  );
}

function RelayHeroBadge() {
  return (
    <View style={styles.heroBadge}>
      <ThemedShieldCheck size={20} uniProps={accentBrightColorMapping} />
    </View>
  );
}

function PairingOffer(props: PairDeviceBodyProps & { offer: { url: string } }) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => inputRef.current?.replaceText(props.offer.url), [props.offer.url]);
  return (
    <View style={styles.offer}>
      <Text style={styles.offerHint}>{t("pairing.device.hint")}</Text>
      <View style={styles.qrTile}>
        <PairingQr svg={props.qrSvg} isError={props.qrError} />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.linkInput}
            initialValue={props.offer.url}
            readOnly
            selectTextOnFocus
            accessibilityLabel={t("pairing.link.label")}
          />
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={props.copied ? Check : Copy}
          onPress={props.onCopy}
        >
          {props.copied ? t("pairing.device.copied") : t("pairing.device.copy")}
        </Button>
      </View>
      <Alert
        size="sm"
        variant="warning"
        description={
          props.passwordProtected
            ? t("pairing.device.passwordSecurity")
            : t("pairing.device.securityWarning")
        }
      />
    </View>
  );
}

function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  if (svg) {
    return (
      <SvgXml
        xml={svg}
        style={styles.qrImage}
        accessibilityRole="image"
        accessibilityLabel={t("pairing.device.qrAccessibility")}
      />
    );
  }
  if (isError) {
    return <Text style={styles.hint}>{t("pairing.device.qrUnavailable")}</Text>;
  }
  return <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  stateLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
  },
  consent: {
    gap: theme.spacing[4],
  },
  hero: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  heroBadge: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[1],
  },
  consentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  consentDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  directRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  directIcon: {
    color: theme.colors.foregroundMuted,
    marginTop: 1, // optical: seats the glyph on the hint's first text line
  },
  directHint: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  offer: {
    gap: theme.spacing[4],
  },
  offerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  qrTile: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    width: 304,
    maxWidth: "100%",
    aspectRatio: 1,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.palette.white,
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
