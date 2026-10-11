// Minimal audited function fixture extracted from Paseo main @166aabd5.
// The patch tool itself enforces the exact upstream Git blob for real use.
// Apache-2.0, getpaseo/paseo contributors (only the state machine is mirrored).
interface TerminalTextInputChange {data: string; key?: string; shouldClear: boolean;}
interface TerminalTextInputState { receiveKeyPress: (key:string)=>TerminalTextInputChange; receiveTextChange:(text:string)=>TerminalTextInputChange; reset:()=>void;}
const CJK_COMPOSITION_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
function isPrintableKey(key: string): boolean {
  return key.length === 1 && key >= " " && key <= "~";
}
function resolveNativeTerminalKey(key: string): string | null {
  return key.startsWith('Arrow') ? key : null;
}
function getCommonPrefixLength(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index++;
  return index;
}
function resolveCompositionEdit(previousText: string, text: string): string {
  const previousCharacters = Array.from(previousText);
  const nextCharacters = Array.from(text);
  const commonPrefixLength = getCommonPrefixLength(previousCharacters, nextCharacters);
  const removed = previousCharacters.slice(commonPrefixLength);
  const inserted = nextCharacters.slice(commonPrefixLength).join("");
  if (removed.length === 0 || inserted.length === 0) return "";
  if (!CJK_COMPOSITION_PATTERN.test(inserted)) return "";
  return `${"\x7f".repeat(removed.length)}${inserted}`;
}
export function createTerminalTextInputState(): TerminalTextInputState {
  let previousText = "";
  let submittedText: string | null = null;
  let replacementDesynced = false;
  return {
    receiveKeyPress(key: string): TerminalTextInputChange {
      const terminalKey = resolveNativeTerminalKey(key);
      if (terminalKey) {
        return { data: "", key: terminalKey, shouldClear: false };
      }
      if (key === "Backspace") {
        previousText = Array.from(previousText).slice(0, -1).join("");
        if (replacementDesynced) {
          return { data: "", shouldClear: false };
        }
        return { data: "\x7f", shouldClear: false };
      }
      if (key === "Enter" || key === "Return" || key === "return") {
        submittedText = previousText;
        return { data: "\r", shouldClear: true };
      }
      if (isPrintableKey(key)) {
        previousText += key;
        return { data: key, shouldClear: false };
      }
      return { data: "", shouldClear: false };
    },
    receiveTextChange(text: string): TerminalTextInputChange {
      if (submittedText !== null) {
        const lateSubmitText = `${submittedText}\n`;
        submittedText = null;
        if (text === lateSubmitText) {
          previousText = "";
          replacementDesynced = false;
          return { data: "", shouldClear: false };
        }
      }

      if (text.length === 0) {
        previousText = "";
        return { data: "", shouldClear: false };
      }

      if (text.includes("\n") || text.includes("\r")) {
        previousText = "";
        replacementDesynced = false;
        return { data: "", shouldClear: true };
      }

      if (!text.startsWith(previousText)) {
        let compositionEdit = "";
        if (!replacementDesynced) {
          compositionEdit = resolveCompositionEdit(previousText, text);
        }
        if (compositionEdit === "") {
          replacementDesynced = true;
        }
        previousText = text;
        return { data: compositionEdit, shouldClear: false };
      }

      const appendedText = text.slice(previousText.length);
      previousText = text;
      return {
        data: appendedText,
        shouldClear: false,
      };
    },
    reset(): void {
      previousText = "";
      replacementDesynced = false;
    },
  };
}
