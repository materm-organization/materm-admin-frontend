import { AxiosError, AxiosHeaders } from "axios";

// A real AxiosError carrying an API error response (what `parseApiError` sees in the app).
export function apiError(
  status: number,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("Request failed", AxiosError.ERR_BAD_REQUEST, config, null, {
    status,
    statusText: String(status),
    data: { success: false, ...body },
    headers,
    config,
  });
}

export function networkError(): AxiosError {
  return new AxiosError("Network Error", AxiosError.ERR_NETWORK, { headers: new AxiosHeaders() });
}
