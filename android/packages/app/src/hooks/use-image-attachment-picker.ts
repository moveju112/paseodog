import { useCallback, useRef } from "react";
import { Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import {
  normalizePickedImageAssets,
  pickImagesWithDesktopDialog,
  type PickedImageAttachmentInput,
} from "@/hooks/image-attachment-picker";
import { isWeb } from "@/constants/platform";
import { captureClientError } from "@/diagnostics/client-error-runtime";
import type { PickerStage } from "@/diagnostics/client-errors";

interface UseImageAttachmentPickerResult {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
}

// 권한·복구 결과를 확인한 뒤 이미지 선택과 첨부 정규화를 직렬 실행한다.
export function useImageAttachmentPicker(): UseImageAttachmentPickerResult {
  const { t } = useTranslation();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const isPickingRef = useRef(false);

  const ensurePermission = useCallback(async () => {
    let currentPermission = mediaPermission;

    if (
      !currentPermission ||
      currentPermission.status === ImagePicker.PermissionStatus.UNDETERMINED
    ) {
      currentPermission = await requestMediaPermission();
    } else if (!currentPermission.granted) {
      currentPermission = await requestMediaPermission();
    }

    if (!currentPermission?.granted) {
      Alert.alert(
        t("imageAttachmentPicker.permissionTitle"),
        t("imageAttachmentPicker.permissionMessage"),
      );
      return false;
    }

    return true;
  }, [mediaPermission, requestMediaPermission, t]);

  const pickImages = useCallback(async () => {
    if (isPickingRef.current) {
      return null;
    }

    isPickingRef.current = true;
    let stage: PickerStage = "permission";

    try {
      if (isWeb && isElectronRuntime()) {
        stage = "desktop";
        const selectedImages = await pickImagesWithDesktopDialog(getDesktopHost()?.dialog);
        if (selectedImages.length === 0) {
          return null;
        }
        return selectedImages;
      }

      // Android 시스템 사진 선택기는 URI별 접근을 부여하므로 라이브러리 권한 요청을 끼우지 않는다.
      if (Platform.OS !== "android") {
        const hasPermission = await ensurePermission();
        if (!hasPermission) {
          return null;
        }
      }

      stage = "recovery";
      const pendingResult = await ImagePicker.getPendingResultAsync();
      if (pendingResult) {
        if (!("canceled" in pendingResult)) {
          throw new Error(`${pendingResult.code}: ${pendingResult.message}`);
        }
        if (pendingResult.canceled) {
          return null;
        }
        stage = "normalize";
        return await normalizePickedImageAssets(pendingResult.assets);
      }

      stage = "launch";
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"] as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (result.canceled) {
        return null;
      }

      stage = "normalize";
      return await normalizePickedImageAssets(result.assets);
    } catch (error) {
      captureClientError(error, "image-picker", stage);
      console.error("[ImageAttachmentPicker] Failed to pick image:", error);
      // 실패 단계·네이티브 원인을 함께 표시해 선택창 실행 오류와 파일 읽기 오류를 구분한다.
      const detail = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      Alert.alert(
        t("imageAttachmentPicker.errorTitle"),
        `${t("imageAttachmentPicker.failedToSelect")}\n\n[${stage}/${code}] ${detail.slice(0, 300)}`,
      );
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, [ensurePermission, t]);

  return { pickImages };
}
