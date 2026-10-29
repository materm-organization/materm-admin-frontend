// An axios call with `responseType: "blob"` that fails delivers the error body as a Blob, so `parseApiError` cannot see the
// machine `code` (`EXPORT_TOO_LARGE`, `RATE_LIMITED`...) or `details`. `unwrapBlobError` reads the Blob as text, parses the
// JSON envelope and puts the parsed object back into `error.response.data`, then returns the same error. Anything that is not
// an axios error with a Blob body (a network error, an HTML gateway page, a body that is not JSON) is returned unchanged.
import axios from "axios";

export async function unwrapBlobError(error: unknown): Promise<unknown> {
  if (!axios.isAxiosError(error)) return error;
  const data: unknown = error.response?.data;
  if (typeof Blob === "undefined" || !(data instanceof Blob)) return error;
  try {
    const parsed: unknown = JSON.parse(await readBlobText(data));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) (error.response as { data: unknown }).data = parsed;
  } catch {
    // Not JSON: the generic status handling applies.
  }
  return error;
}

// `Blob.text()` is missing in old jsdom builds; FileReader works everywhere.
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
