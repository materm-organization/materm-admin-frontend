// An axios adapter that answers from MSW handlers in the BROWSER - no service worker, no `public/` file. The
// admin's two axios instances are pointed at it by `installApiMock()` so the real screens can be tried (and
// clicked through by Playwright) before the backend endpoints exist. The URL is normalised to
// `http://mock.local/api/v1/...`, whatever `NEXT_PUBLIC_API_BASE_URL` is; the handlers match `*/api/v1/...`.
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { getResponse, type RequestHandler } from "msw";

const MOCK_BASE = "http://mock.local/api/v1";
const MOCK_DELAY_MS = 120;

export function createMockAdapter(handlers: RequestHandler[]): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const url = axios.getUri({ baseURL: MOCK_BASE, url: config.url, params: config.params, paramsSerializer: config.paramsSerializer });
    const method = (config.method ?? "get").toUpperCase();
    const headers = new Headers();
    for (const [key, value] of Object.entries(AxiosHeaders.from(config.headers).toJSON())) {
      if (typeof value === "string") headers.set(key, value);
    }
    const body = method === "GET" || method === "HEAD" || config.data === undefined ? undefined : typeof config.data === "string" ? config.data : JSON.stringify(config.data);
    if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    const request = new Request(url, { method, headers, body });

    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    const response = await getResponse(handlers, request);
    const notMocked = response === undefined;
    const raw = notMocked
      ? new Response(JSON.stringify({ success: false, code: "NOT_FOUND", message: `No mock for ${method} ${new URL(url).pathname}` }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      : response;

    const text = await raw.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      /* not JSON: keep the text */
    }
    const result: AxiosResponse = {
      data,
      status: raw.status,
      statusText: raw.statusText,
      headers: AxiosHeaders.from(Object.fromEntries(raw.headers.entries())),
      config,
      request: { mock: true },
    };
    const validate = config.validateStatus ?? ((status: number) => status >= 200 && status < 300);
    if (!validate(result.status)) {
      throw new AxiosError(`Request failed with status code ${result.status}`, result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, result.request, result);
    }
    return result;
  };
}
