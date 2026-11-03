import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag, type WithEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateWebhookPayload,
  UpdateWebhookPayload,
  Webhook,
  WebhookDeliveriesQuery,
  WebhookDelivery,
  WebhookTestResult,
  WebhookWithSecret,
  WebhooksQuery,
} from "@/types/webhooks";

// External webhooks (doc/05 section 16). The ETag is `etag` (a hash of the editable fields; the `ETag` header carries the same value): a
// list row has it too, so `etagOfWebhook` never falls back to `updated_at`. Create and rotate-secret answer `data.secret` ONCE: it is cut
// off HERE and handed to `onSecret`, so what the callers (React Query's mutation and query caches) keep never holds it.
export class MissingWebhookEtagError extends Error {
  constructor() {
    super("Missing webhook ETag");
    this.name = "MissingWebhookEtagError";
  }
}
export function etagOfWebhook(row: Pick<Webhook, "etag">, headerEtag?: string): string {
  const value = headerEtag || row.etag;
  if (!value) throw new MissingWebhookEtagError();
  return value;
}

// Separates the one-time secret from the webhook row. Pure.
export function splitSecret(raw: WebhookWithSecret): { webhook: Webhook; secret: string | null } {
  const { secret, ...webhook } = raw;
  return { webhook, secret: typeof secret === "string" && secret !== "" ? secret : null };
}

async function stripSecret(
  response: Awaited<ReturnType<typeof axiosInstance.post<ApiResponse<WebhookWithSecret>>>>,
  onSecret: (secret: string | null) => void
): Promise<WithEtag<ApiResponse<Webhook>>> {
  const { webhook, secret } = splitSecret(response.data.data);
  onSecret(secret);
  const { etag } = withEtag(response);
  return { data: { ...response.data, data: webhook }, etag: etag ?? webhook.etag };
}

export const WebhooksAPI = {
  List: async (query: WebhooksQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<Webhook[]>>(API_ENDPOINTS.WEBHOOKS.LIST, { params: query });
    return data;
  },
  Get: async (id: number | string) => withEtag(await axiosInstance.get<ApiResponse<Webhook>>(API_ENDPOINTS.WEBHOOKS.DETAIL(id))),
  Create: async (payload: CreateWebhookPayload, onSecret: (secret: string | null) => void, idempotencyKey?: string) =>
    stripSecret(
      await axiosInstance.post<ApiResponse<WebhookWithSecret>>(API_ENDPOINTS.WEBHOOKS.LIST, payload, { headers: idempotencyKeyHeaders(idempotencyKey) }),
      onSecret
    ),
  Update: async (id: number | string, payload: UpdateWebhookPayload, etag: string | undefined) =>
    withEtag(await axiosInstance.patch<ApiResponse<Webhook>>(API_ENDPOINTS.WEBHOOKS.DETAIL(id), payload, ifMatch(etag, { required: true }))),
  // Soft delete; no trash, no restore.
  Delete: async (id: number | string, etag: string | undefined) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.WEBHOOKS.DETAIL(id), ifMatch(etag, { required: true }));
    return data;
  },
  RotateSecret: async (id: number | string, etag: string | undefined, onSecret: (secret: string | null) => void) =>
    stripSecret(
      await axiosInstance.post<ApiResponse<WebhookWithSecret>>(API_ENDPOINTS.WEBHOOKS.ROTATE_SECRET(id), undefined, ifMatch(etag, { required: true })),
      onSecret
    ),
  // Sends the signed `webhook.test` envelope NOW (synchronously). 200 even when the receiver failed (`ok: false`).
  Test: async (id: number | string) => {
    const { data } = await axiosInstance.post<ApiResponse<WebhookTestResult>>(API_ENDPOINTS.WEBHOOKS.TEST(id));
    return data;
  },
  Deliveries: async (id: number | string, query: WebhookDeliveriesQuery = {}) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<WebhookDelivery[]>>(API_ENDPOINTS.WEBHOOKS.DELIVERIES(id), { params: query });
    return data;
  },
  Retry: async (deliveryId: number | string) => {
    const { data } = await axiosInstance.post<ApiResponse<WebhookDelivery>>(API_ENDPOINTS.WEBHOOKS.RETRY_DELIVERY(deliveryId));
    return data;
  },
};
