// Re-exports the class-name merge helper used by generated `components/ui/*`
// primitives (which import `cn` directly from the `cn` package — shadcn's
// current codegen output) so the rest of the app can consistently import it
// from `@/lib/utils`.
export { cn } from "cn";

// Used by components/global/keyword-filter.tsx's filter-pill display.
export const truncateText = (text: string, maxLength: number = 20) => {
  if (!text) return "";
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

// Copies text to the clipboard, with a fallback for non-secure contexts.
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for HTTP or browsers without Clipboard API
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("copy failed");
}
