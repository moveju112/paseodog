import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { systemBackPress } from "@/components/ui/isolated-bottom-sheet-modal/back-press";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ScrollView as SheetScrollView } from "@/components/ui/scroll-view";
import { useProviderIcon } from "@/components/provider-icons";
import { ModelBrowser, useModelBrowser } from "@/components/model-browser";
import { resolveModelBrowserScrolling } from "@/components/model-browser-view";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { resolveModelSheetOpening } from "@/composer/agent-controls/model-sheet-flow";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";

const SNAP_POINTS = ["80%", "90%"];
const MODEL_LIST_TOP_INSET = 4;
const MODEL_ROW_STRIDE = 44;
const MODEL_VIEWPORT_VISIBLE_ROWS = 4.5;
const FIXED_MODEL_VIEWPORT_HEIGHT =
  MODEL_LIST_TOP_INSET + MODEL_ROW_STRIDE * MODEL_VIEWPORT_VISIBLE_ROWS;

interface CompactModelSheetProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  thinkingLabel: string | null;
  onSelect: (provider: string, modelId: string) => void;
  isLoading: boolean;
  profiles?: AgentProfilePicker | null;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
  glyphSize: number;
  canSwitchProvider: boolean;
  /** Compact bottom sheet only: thinking choices shown as an internal page of the root sheet. */
  thinkingPage?: CompactSheetThinkingPage | null;
  children: ReactNode | ((navigation: CompactSheetNavigation) => ReactNode);
}

// 모바일 루트 시트 하나 안에서 전환하는 내부 페이지
type CompactSheetPage = "menu" | "model" | "thinking";

export interface CompactSheetNavigation {
  /** Present only when the thinking choices render as an internal page. */
  openThinkingPage?: () => void;
}

export interface CompactSheetThinkingPage {
  title: string;
  options: ComboboxOption[];
  value: string;
  onSelect: (optionId: string) => void;
  renderOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

// 사고 수준 옵션 한 줄 렌더 (옵션 → 기존 renderOption)
function ThinkingPageRow({
  option,
  selected,
  onSelect,
  renderOption,
}: {
  option: ComboboxOption;
  selected: boolean;
  onSelect: (optionId: string) => void;
  renderOption: CompactSheetThinkingPage["renderOption"];
}) {
  const handlePress = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return <View>{renderOption({ option, selected, active: false, onPress: handlePress })}</View>;
}

// 사고 수준 내부 페이지 목록 (옵션 목록 → 선택 시 메뉴 복귀)
function ThinkingPageList({
  thinkingPage,
  onSelect,
}: {
  thinkingPage: CompactSheetThinkingPage | null;
  onSelect: (optionId: string) => void;
}) {
  if (!thinkingPage) return null;
  return (
    <View
      style={[styles.modelViewport, styles.flexibleModelViewport]}
      testID="agent-controls-thinking-page"
    >
      <SheetScrollView
        style={styles.controlsScroll}
        contentContainerStyle={styles.controlsContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {thinkingPage.options.map((option) => (
          <ThinkingPageRow
            key={option.id}
            option={option}
            selected={option.id === thinkingPage.value}
            onSelect={onSelect}
            renderOption={thinkingPage.renderOption}
          />
        ))}
      </SheetScrollView>
    </View>
  );
}

// 내부 페이지 전환 상태 결정 (메뉴 ↔ 모델/사고 페이지, 바텀시트 전용)
function useCompactSheetPages({
  page,
  setPage,
  usesBottomSheet,
  thinkingPage,
  rootHeader,
  modelHeader,
  returnToMenu,
}: {
  page: CompactSheetPage;
  setPage: (page: CompactSheetPage) => void;
  usesBottomSheet: boolean;
  thinkingPage: CompactSheetThinkingPage | null;
  rootHeader: SheetHeader;
  modelHeader: SheetHeader;
  returnToMenu: () => void;
}) {
  // 사고 수준 내부 페이지 열기 (메뉴 → 사고 페이지)
  const openThinkingPage = useCallback(() => {
    Keyboard.dismiss();
    setPage("thinking");
  }, [setPage]);

  // 사고 수준 선택 후 메뉴 복귀 (선택 → 기존 저장 경로 → 메뉴)
  const handleThinkingSelect = useCallback(
    (optionId: string) => {
      thinkingPage?.onSelect(optionId);
      returnToMenu();
    },
    [returnToMenu, thinkingPage],
  );

  const navigation = useMemo<CompactSheetNavigation>(
    () => (usesBottomSheet && thinkingPage ? { openThinkingPage } : {}),
    [openThinkingPage, thinkingPage, usesBottomSheet],
  );
  const visiblePage: CompactSheetPage =
    !usesBottomSheet || (page === "thinking" && !thinkingPage) ? "menu" : page;
  const thinkingTitle = thinkingPage?.title ?? "";
  const sheetHeader = useMemo(
    () =>
      resolveCompactSheetHeader({
        page: visiblePage,
        rootHeader,
        modelHeader,
        thinkingTitle,
        returnToMenu,
      }),
    [modelHeader, returnToMenu, rootHeader, thinkingTitle, visiblePage],
  );
  useInternalPageBackPress(visiblePage === "menu" ? undefined : sheetHeader.back?.onPress);
  return { navigation, visiblePage, sheetHeader, handleThinkingSelect };
}

// Android 뒤로가기 → 내부 페이지 한 단계 뒤로 (시트 전체 닫힘 방지, 메뉴에서는 기존 닫기)
function useInternalPageBackPress(onBack: (() => void) | undefined) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const hasInternalBack = onBack !== undefined;
  useEffect(() => {
    if (!hasInternalBack) return undefined;
    // 시트보다 늦게 등록되어 먼저 호출되고, 처리 후 시트 닫기를 막는다
    return systemBackPress.subscribe(() => {
      onBackRef.current?.();
      return true;
    });
  }, [hasInternalBack]);
}

// 내부 페이지 헤더 결정 (페이지 → 루트/모델/사고 헤더, 뒤로 → 메뉴)
function resolveCompactSheetHeader({
  page,
  rootHeader,
  modelHeader,
  thinkingTitle,
  returnToMenu,
}: {
  page: CompactSheetPage;
  rootHeader: SheetHeader;
  modelHeader: SheetHeader;
  thinkingTitle: string;
  returnToMenu: () => void;
}): SheetHeader {
  if (page === "thinking") {
    return { title: thinkingTitle, back: { onPress: returnToMenu } };
  }
  if (page === "model") {
    return {
      ...modelHeader,
      back: modelHeader.back ?? { onPress: returnToMenu },
      search: modelHeader.search
        ? { ...modelHeader.search, resetKey: `model:${modelHeader.search.resetKey ?? ""}` }
        : undefined,
    };
  }
  return rootHeader;
}

function shortModelLabel(label: string): string {
  const separatorIndex = label.lastIndexOf("/");
  return separatorIndex === -1 ? label : label.slice(separatorIndex + 1);
}

function resolveModelSheetProfileActions(
  onCreateProfile: ((seed: AgentProfileSeed) => void) | undefined,
  onEditProfile: ((profileId: string) => void) | undefined,
  close: () => void,
): {
  create?: (seed: AgentProfileSeed) => void;
  edit?: (profileId: string) => void;
} {
  return {
    create: onCreateProfile
      ? (seed: AgentProfileSeed) => {
          close();
          onCreateProfile(seed);
        }
      : undefined,
    edit: onEditProfile
      ? (profileId: string) => {
          close();
          onEditProfile(profileId);
        }
      : undefined,
  };
}

export function CompactModelSheet({
  providers,
  selectedProvider,
  selectedModel,
  thinkingLabel,
  onSelect,
  isLoading,
  profiles = null,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
  glyphSize,
  canSwitchProvider,
  thinkingPage = null,
  children,
}: CompactModelSheetProps) {
  const { t } = useTranslation();
  const usesBottomSheet = useIsCompactFormFactor();
  const modelBrowserScrolling = resolveModelBrowserScrolling({
    isNative,
    isCompact: usesBottomSheet,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState<CompactSheetPage>("menu");
  const availableProviders = useMemo(() => {
    if (canSwitchProvider) return providers;
    const fixedProvider =
      providers.find((entry) => entry.id === selectedProvider) ?? providers[0] ?? null;
    return fixedProvider ? [fixedProvider] : [];
  }, [canSwitchProvider, providers, selectedProvider]);
  const rootBrowser = useModelBrowser({
    providers: availableProviders,
    selectedProvider,
    selectedModel,
    isLoading,
    autoFocusSearch: isWeb && !usesBottomSheet,
    profiles,
    serverId,
  });
  const modelBrowser = useModelBrowser({
    providers: availableProviders,
    selectedProvider,
    selectedModel,
    isLoading,
    autoFocusSearch: isWeb && !usesBottomSheet,
    profiles,
    serverId,
  });
  const ModelIcon = useProviderIcon(selectedProvider, serverId);
  const hasSelectedProvider = selectedProvider.trim().length > 0;
  const rootHeader = useMemo(
    () => ({
      ...rootBrowser.header,
      title: t("modelSelector.selectModel"),
      search:
        rootBrowser.header.search && !canSwitchProvider
          ? {
              ...rootBrowser.header.search,
              placeholder: t("modelSelector.searchPlaceholder"),
            }
          : rootBrowser.header.search,
    }),
    [canSwitchProvider, rootBrowser.header, t],
  );

  const open = useCallback(() => {
    Keyboard.dismiss();
    rootBrowser.showAll();
    setPage("menu");
    setIsOpen(true);
    onOpen?.();
  }, [onOpen, rootBrowser]);

  const close = useCallback(() => {
    setPage("menu");
    setIsOpen(false);
    rootBrowser.reset();
    modelBrowser.reset();
    onClose?.();
  }, [modelBrowser, onClose, rootBrowser]);

  const handleSearchSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      Keyboard.dismiss();
      rootBrowser.showAll();
    },
    [onSelect, rootBrowser],
  );

  const openModelBrowser = useCallback(() => {
    Keyboard.dismiss();
    const destination = resolveModelSheetOpening({
      canSwitchProvider,
      providers: availableProviders,
      selectedProvider,
    });
    if (destination.kind === "all") {
      modelBrowser.showAll();
    } else {
      modelBrowser.drillDown(destination.providerId, destination.providerLabel);
    }
    setPage("model");
  }, [availableProviders, canSwitchProvider, modelBrowser, selectedProvider]);

  // 내부 페이지 → 루트 메뉴 복귀 (같은 시트 유지)
  const returnToMenu = useCallback(() => {
    Keyboard.dismiss();
    setPage("menu");
    modelBrowser.reset();
    rootBrowser.showAll();
  }, [modelBrowser, rootBrowser]);

  const handleBrowserSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      returnToMenu();
    },
    [onSelect, returnToMenu],
  );

  const { navigation, visiblePage, sheetHeader, handleThinkingSelect } = useCompactSheetPages({
    page,
    setPage,
    usesBottomSheet,
    thinkingPage,
    rootHeader,
    modelHeader: modelBrowser.header,
    returnToMenu,
  });
  const renderedChildren = typeof children === "function" ? children(navigation) : children;

  const handleDesktopSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      close();
    },
    [close, onSelect],
  );

  const handleApplyProfile = useCallback(
    (profileId: string) => {
      onApplyProfile?.(profileId);
      close();
    },
    [close, onApplyProfile],
  );

  const handleEditProfiles = useCallback(() => {
    close();
    onEditProfiles?.();
  }, [close, onEditProfiles]);

  const profileActions = resolveModelSheetProfileActions(onCreateProfile, onEditProfile, close);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
      return;
    }
    open();
  }, [close, isOpen, open]);

  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.trigger,
      hovered && styles.triggerHovered,
      (pressed || isOpen) && styles.triggerPressed,
      disabled && styles.triggerDisabled,
    ],
    [disabled, isOpen],
  );
  const mobileRootContent = useMemo(
    () => (
      <View style={styles.mobileRootContent} testID="agent-controls-settings-list">
        <View style={styles.controlsContent}>
          <AgentControlTrigger
            icon={ModelIcon}
            surface="sheet"
            label={t("modelSelector.model")}
            value={rootBrowser.selectedModelLabel}
            disabled={disabled}
            onPress={openModelBrowser}
            accessibilityLabel={t("modelSelector.selectedModel", {
              model: rootBrowser.selectedModelLabel,
            })}
            testID="agent-controls-model"
          />
          {renderedChildren}
        </View>
      </View>
    ),
    [ModelIcon, disabled, openModelBrowser, renderedChildren, rootBrowser.selectedModelLabel, t],
  );

  return (
    <>
      <ComboboxTrigger
        collapsable={false}
        disabled={disabled}
        onPress={toggle}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("modelSelector.selectedModel", {
          model: rootBrowser.selectedModelLabel,
        })}
        testID="combined-model-selector"
        chevron={null}
      >
        {hasSelectedProvider ? (
          <ComposerToolbarGlyph size={glyphSize}>
            <ModelIcon size={glyphSize} color={styles.providerIcon.color} />
          </ComposerToolbarGlyph>
        ) : null}
        <View style={styles.triggerLabels}>
          <Text style={styles.triggerText} numberOfLines={1}>
            {shortModelLabel(rootBrowser.triggerLabel)}
          </Text>
          {thinkingLabel ? (
            <Text style={styles.triggerThinking} numberOfLines={1}>
              {thinkingLabel}
            </Text>
          ) : null}
        </View>
      </ComboboxTrigger>

      <AdaptiveModalSheet
        header={sheetHeader}
        visible={isOpen}
        onClose={close}
        snapPoints={SNAP_POINTS}
        scrollable={false}
        sizeContentToCurrentSnapPoint={usesBottomSheet}
        contentStyle={styles.sheetBody}
        testID="agent-controls-model-sheet"
      >
        {visiblePage === "menu" ? (
          <View
            style={[
              styles.modelViewport,
              usesBottomSheet ? styles.flexibleModelViewport : styles.fixedModelViewport,
            ]}
            testID="agent-controls-model-viewport"
          >
            <ModelBrowser
              state={rootBrowser}
              onSelect={usesBottomSheet ? handleSearchSelect : handleDesktopSelect}
              onApplyProfile={handleApplyProfile}
              onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
              onCreateProfile={profileActions.create}
              onEditProfile={profileActions.edit}
              onRetryProvider={onRetryProvider}
              isRetryingProvider={isRetryingProvider}
              scrolling={modelBrowserScrolling}
              searchAllOnFocus={usesBottomSheet}
              rootBrowseContent={usesBottomSheet ? mobileRootContent : undefined}
            />
          </View>
        ) : null}
        {visiblePage === "model" ? (
          <View
            style={[styles.modelViewport, styles.flexibleModelViewport]}
            testID="agent-controls-model-browser-viewport"
          >
            <ModelBrowser
              state={modelBrowser}
              onSelect={handleBrowserSelect}
              onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
              onCreateProfile={profileActions.create}
              onEditProfile={profileActions.edit}
              onRetryProvider={onRetryProvider}
              isRetryingProvider={isRetryingProvider}
              scrolling={modelBrowserScrolling}
              searchAllOnFocus
              showProfilesSection={false}
            />
          </View>
        ) : null}
        {visiblePage === "thinking" ? (
          <ThinkingPageList thinkingPage={thinkingPage} onSelect={handleThinkingSelect} />
        ) : null}
        {!usesBottomSheet ? (
          <>
            <View style={styles.modelViewportDivider} />
            <ScrollView
              style={styles.controlsScroll}
              contentContainerStyle={styles.controlsContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              testID="agent-controls-settings-list"
            >
              {renderedChildren}
            </ScrollView>
          </>
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface0,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  triggerLabels: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  triggerThinking: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  providerIcon: {
    color: theme.colors.foregroundMuted,
  },
  sheetBody: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  modelViewport: {
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSidebar,
  },
  flexibleModelViewport: {
    flex: 1,
    minHeight: 0,
  },
  fixedModelViewport: {
    height: FIXED_MODEL_VIEWPORT_HEIGHT,
    minHeight: FIXED_MODEL_VIEWPORT_HEIGHT,
  },
  modelViewportDivider: {
    height: 1,
    flexShrink: 0,
    backgroundColor: theme.colors.border,
  },
  controlsScroll: {
    flex: 1,
    minHeight: 0,
  },
  mobileRootContent: {
    backgroundColor: theme.colors.surfaceSidebar,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  controlsContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
}));
