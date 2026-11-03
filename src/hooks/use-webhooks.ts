import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { WebhooksAPI } from "@/services/webhooks.api";
import type { CreateWebhookPayload, UpdateWebhookPayload, WebhookDeliveriesQuery, WebhooksQuery } from "@/types/webhooks";

export const WEBHOOKS_LIST_KEY = [API_ENDPOINTS.WEBHOOKS.LIST] as const;
export const webhookDeliveriesKey = (id: number) => [API_ENDPOINTS.WEBHOOKS.DELIVERIES(id)] as const;

export const useWebhooks = (query: WebhooksQuery, enabled = true) =>
  useQuery({ queryKey: [...WEBHOOKS_LIST_KEY, query], queryFn: () => WebhooksAPI.List(query), enabled, placeholderData: keepPreviousData });

export const useWebhookDeliveries = (id: number, query: WebhookDeliveriesQuery, enabled = true) =>
  useQuery({ queryKey: [...webhookDeliveriesKey(id), query], queryFn: () => WebhooksAPI.Deliveries(id, query), enabled, placeholderData: keepPreviousData });

// A write changes the row (and the History tab); a test or a retry changes the deliveries.
function useRefresh() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    void queryClient.invalidateQueries({ queryKey: WEBHOOKS_LIST_KEY });
    if (id !== undefined) {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.WEBHOOKS.DETAIL(id)] });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUDIT.LIST] });
    }
  };
}

// The one-time secret NEVER enters React Query: the service hands it to `onSecret` and returns the webhook without it, so neither the
// mutation's `data` nor any query cache holds it, and it is not part of any query key. The caller keeps it in its own state only while
// the OneTimeSecretDialog is open.
export const useMutationCreateWebhook = () => {
  const refresh = useRefresh();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ payload, idempotencyKey, onSecret }: { payload: CreateWebhookPayload; idempotencyKey?: string; onSecret: (secret: string | null) => void }) =>
      WebhooksAPI.Create(payload, onSecret, idempotencyKey),
    onSuccess: () => refresh(),
  });
};
export const useMutationUpdateWebhook = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateWebhookPayload; etag: string | undefined }) => WebhooksAPI.Update(id, payload, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationDeleteWebhook = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => WebhooksAPI.Delete(id, etag),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationRotateWebhookSecret = () => {
  const refresh = useRefresh();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ id, etag, onSecret }: { id: number; etag: string | undefined; onSecret: (secret: string | null) => void }) =>
      WebhooksAPI.RotateSecret(id, etag, onSecret),
    onSuccess: (_r, { id }) => refresh(id),
  });
};
export const useMutationTestWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ id }: { id: number }) => WebhooksAPI.Test(id),
    onSuccess: (_r, { id }) => {
      void queryClient.invalidateQueries({ queryKey: webhookDeliveriesKey(id) });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUDIT.LIST] });
    },
  });
};
export const useMutationRetryWebhookDelivery = (webhookId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deliveryId }: { deliveryId: number }) => WebhooksAPI.Retry(deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webhookDeliveriesKey(webhookId) });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUDIT.LIST] });
    },
  });
};
