export interface BottomSheetController {
  present(): void;
  dismiss(): void;
}

export interface BottomSheetVisibilityInput {
  visible: boolean;
  isEnabled?: boolean;
}

/**
 * The system Back press, as the tracker needs it.
 *
 * A sheet is presented through `@gorhom/portal`, which renders it into the app's own view tree
 * rather than a native modal window, so Android delivers Back to the navigator underneath it
 * unless something on top claims the press first.
 *
 * `subscribe` registers a listener and returns its removal. The listener returns `true` when it
 * claims the press. Listeners are offered the press newest-first, so a tracker holds its
 * subscription only while its sheet is on screen, and a stacked sheet answers before the one
 * below it.
 */
export interface BackPressSource {
  subscribe(onBackPress: () => boolean): () => void;
}

export interface BottomSheetVisibilityTracker {
  attachController(controller: BottomSheetController | null): void;
  syncDesired(input: BottomSheetVisibilityInput): void;
  handleSheetIndexChange(index: number): void;
  handleSheetDismiss(): void;
}

type BottomSheetPhase = "closed" | "presenting" | "presented" | "hidden" | "dismissing";

export function createBottomSheetVisibilityTracker(opts: {
  onClose: () => void;
  backPress?: BackPressSource;
}): BottomSheetVisibilityTracker {
  let controller: BottomSheetController | null = null;
  let visible = false;
  let isEnabled: boolean | undefined;
  let phase: BottomSheetPhase = "closed";
  let hasNotifiedClose = false;
  let requestedDismiss = false;
  let releaseBackPress: (() => void) | null = null;

  function setPhase(next: BottomSheetPhase): void {
    phase = next;
    syncBackPress();
  }

  /** Holds the Back press for exactly the window the sheet is on screen, and no longer. */
  function syncBackPress(): void {
    const wantsBackPress = phase === "presented" && controller !== null;
    if (wantsBackPress === (releaseBackPress !== null)) return;
    if (!wantsBackPress) {
      releaseBackPress?.();
      releaseBackPress = null;
      return;
    }
    releaseBackPress =
      opts.backPress?.subscribe(() => {
        dismiss();
        return true;
      }) ?? null;
  }

  function present(): void {
    if (!controller || phase !== "closed" || hasNotifiedClose) return;
    setPhase("presenting");
    controller.present();
  }

  function dismiss(requested = false): void {
    if (!controller || phase === "closed" || phase === "dismissing") return;
    requestedDismiss = requested;
    setPhase("dismissing");
    controller.dismiss();
  }

  function notifyClose(): void {
    if (hasNotifiedClose) return;
    hasNotifiedClose = true;
    opts.onClose();
  }

  return {
    attachController(next) {
      controller = next;
      // A sheet that left the tree cannot answer, so it lets go of the press without changing
      // phase: the parent has not acknowledged the dismissal yet.
      syncBackPress();
      if (next && visible && isEnabled !== false) {
        present();
      }
    },
    syncDesired(next) {
      visible = next.visible;
      isEnabled = next.isEnabled;
      if (isEnabled === false) return;
      if (visible) {
        present();
        return;
      }
      if (phase === "closed") {
        hasNotifiedClose = false;
        return;
      }
      // A hidden prop is not the native dismissal acknowledgement.
      // Queue a new presentation until handleSheetDismiss confirms completion.
      dismiss(true);
    },
    handleSheetIndexChange(index) {
      if (index !== -1) {
        if (phase === "presenting" || phase === "hidden") {
          setPhase("presented");
        }
        return;
      }
      if (phase === "presented") {
        // A parent hidden by a stacked selector has not actually been dismissed.
        setPhase("hidden");
      }
    },
    handleSheetDismiss() {
      if (phase === "closed") return;
      const reopen = requestedDismiss && visible && isEnabled !== false;
      requestedDismiss = false;
      setPhase("closed");
      if (reopen) {
        present();
        return;
      }
      if (visible) {
        notifyClose();
        return;
      }
      hasNotifiedClose = false;
    },
  };
}
