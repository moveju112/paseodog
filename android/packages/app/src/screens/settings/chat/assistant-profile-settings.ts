import type { AssistantIcon } from "@/hooks/use-settings/assistant-icons";

interface ProfileDependencies {
  React: typeof import("react");
  View: typeof import("react-native").View;
  Image: typeof import("react-native").Image;
  SettingsSelect: typeof import("@/components/settings").SettingsSelect;
  SettingsAction: typeof import("@/components/settings").SettingsAction;
  SettingsRow: typeof import("@/components/settings").SettingsRow;
  useTranslation: typeof import("react-i18next").useTranslation;
  useAppSettings: typeof import("@/hooks/use-settings").useAppSettings;
  pickPhoto: () => Promise<string | null>;
  icons: readonly AssistantIcon[];
}

// 네이티브 화면과 고정 웹 번들이 같은 UI·저장·경합 처리 코드를 사용한다.
export function createAssistantProfileSettings(deps: ProfileDependencies) {
  const {
    React,
    View,
    Image,
    SettingsSelect,
    SettingsAction,
    SettingsRow,
    useTranslation,
    useAppSettings,
    pickPhoto,
    icons,
  } = deps;
  const copies: Record<
    string,
    {
      label: string;
      hint: string;
      choose: string;
      replace: string;
      remove: string;
      busy: string;
      error: string;
    }
  > = {
    en: {
      label: "Profile photo",
      hint: "Saved only on this device as a 256px thumbnail. Up to 20 MiB.",
      choose: "Choose photo",
      replace: "Replace photo",
      remove: "Remove photo",
      busy: "Saving…",
      error: "Could not save the photo. Choose a supported image up to 20 MiB and try again.",
    },
    ko: {
      label: "프로필 사진",
      hint: "256px 썸네일로 이 기기에만 저장돼요. 원본은 최대 20MiB예요.",
      choose: "사진 선택",
      replace: "사진 변경",
      remove: "사진 삭제",
      busy: "저장 중…",
      error: "사진을 저장하지 못했어요. 20MiB 이하의 지원되는 이미지로 다시 시도해 주세요.",
    },
    ja: {
      label: "プロフィール写真",
      hint: "256pxのサムネイルとしてこの端末だけに保存します。最大20MiB。",
      choose: "写真を選択",
      replace: "写真を変更",
      remove: "写真を削除",
      busy: "保存中…",
      error: "写真を保存できませんでした。20MiB以下の対応画像で再試行してください。",
    },
    fr: {
      label: "Photo de profil",
      hint: "Miniature de 256px enregistrée uniquement sur cet appareil. 20 Mio maximum.",
      choose: "Choisir une photo",
      replace: "Changer la photo",
      remove: "Supprimer la photo",
      busy: "Enregistrement…",
      error:
        "Impossible d’enregistrer la photo. Réessayez avec une image prise en charge de 20 Mio maximum.",
    },
    es: {
      label: "Foto de perfil",
      hint: "Miniatura de 256px guardada solo en este dispositivo. Máximo 20 MiB.",
      choose: "Elegir foto",
      replace: "Cambiar foto",
      remove: "Eliminar foto",
      busy: "Guardando…",
      error: "No se pudo guardar la foto. Prueba con una imagen compatible de hasta 20 MiB.",
    },
    "pt-BR": {
      label: "Foto de perfil",
      hint: "Miniatura de 256px salva somente neste dispositivo. Máximo de 20 MiB.",
      choose: "Escolher foto",
      replace: "Trocar foto",
      remove: "Remover foto",
      busy: "Salvando…",
      error: "Não foi possível salvar a foto. Tente uma imagem compatível de até 20 MiB.",
    },
    ru: {
      label: "Фото профиля",
      hint: "Миниатюра 256px сохраняется только на этом устройстве. До 20 МиБ.",
      choose: "Выбрать фото",
      replace: "Заменить фото",
      remove: "Удалить фото",
      busy: "Сохранение…",
      error: "Не удалось сохранить фото. Выберите поддерживаемое изображение размером до 20 МиБ.",
    },
    "zh-CN": {
      label: "头像照片",
      hint: "以256px缩略图仅保存在此设备上。原图最大20MiB。",
      choose: "选择照片",
      replace: "更换照片",
      remove: "删除照片",
      busy: "正在保存…",
      error: "无法保存照片。请使用不超过20MiB的受支持图片重试。",
    },
    ar: {
      label: "صورة الملف الشخصي",
      hint: "تُحفظ على هذا الجهاز فقط كصورة مصغرة بحجم 256 بكسل. الحد الأقصى 20 MiB.",
      choose: "اختيار صورة",
      replace: "تغيير الصورة",
      remove: "حذف الصورة",
      busy: "جارٍ الحفظ…",
      error: "تعذر حفظ الصورة. أعد المحاولة بصورة مدعومة لا يتجاوز حجمها 20 MiB.",
    },
  };

  return function AssistantProfileSettings({ testID }: { testID?: string }) {
    const { t, i18n } = useTranslation();
    const copy = copies[i18n.resolvedLanguage ?? i18n.language] ?? copies.en;
    const { settings, updateSettings } = useAppSettings();
    const idleActionLabel = settings.assistantPhoto ? copy.replace : copy.choose;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const pending = React.useRef(false);
    const generation = React.useRef(0);
    React.useEffect(
      () => () => {
        generation.current++;
      },
      [],
    );

    async function choose() {
      if (pending.current) return;
      const token = ++generation.current;
      pending.current = true;
      setBusy(true);
      setError("");
      try {
        const photo = await pickPhoto();
        if (token !== generation.current || photo === null) return;
        await updateSettings({ assistantPhoto: photo });
      } catch {
        if (token === generation.current) setError(copy.error);
      } finally {
        if (token === generation.current) {
          pending.current = false;
          setBusy(false);
        }
      }
    }

    async function clear(assistantIcon?: AssistantIcon) {
      const token = ++generation.current;
      pending.current = false;
      setBusy(false);
      setError("");
      try {
        await updateSettings({
          assistantPhoto: "",
          ...(assistantIcon === undefined ? {} : { assistantIcon }),
        });
      } catch {
        if (token === generation.current) setError(copy.error);
      }
    }

    return React.createElement(
      View,
      { testID },
      React.createElement(SettingsSelect, {
        label: t("settings.general.assistantIcon.label"),
        hint: t("settings.general.assistantIcon.description"),
        value: settings.assistantIcon,
        options: icons.map((value) => ({
          value,
          label: value || t("settings.general.assistantIcon.initial"),
        })),
        onValueChange: (icon: AssistantIcon) => {
          void clear(icon);
        },
        testID: "assistant-icon-select",
      }),
      settings.assistantPhoto
        ? React.createElement(
            SettingsRow,
            { label: copy.label, testID: "assistant-photo-preview" },
            React.createElement(Image, {
              source: { uri: settings.assistantPhoto },
              style: { width: 56, height: 56, borderRadius: 12 },
              resizeMode: "cover",
              accessible: false,
            }),
          )
        : null,
      React.createElement(SettingsAction, {
        label: copy.label,
        hint: copy.hint,
        error,
        actionLabel: busy ? copy.busy : idleActionLabel,
        onPress: () => {
          void choose();
        },
        disabled: busy,
        testID: "assistant-photo-pick",
      }),
      settings.assistantPhoto
        ? React.createElement(SettingsAction, {
            label: copy.remove,
            actionLabel: copy.remove,
            onPress: () => {
              void clear();
            },
            testID: "assistant-photo-remove",
          })
        : null,
    );
  };
}
