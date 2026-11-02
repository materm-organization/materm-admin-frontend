import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  mediaAssetKey,
  useMediaAssetDetail,
  useMediaAssets,
  useMediaFolders,
  useMediaUsages,
  useMutationCreateMediaFolder,
  useMutationDeleteMediaAsset,
  useMutationRestoreMediaAsset,
  useMutationUpdateMediaAsset,
} from "@/hooks/use-media";
import { MissingEtagError } from "@/lib/etag";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { etagOf } from "@/mocks/mock-core";

const API = "*/api/v1";

function setup() {
  // gcTime Infinity: entries with no observer (seeded by hand below) must stay to be inspected.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

describe("media hooks", () => {
  useMockApi();

  it("useMediaAssets sends the query and keeps the previous page while the next loads", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ q }) => useMediaAssets(q), { wrapper, initialProps: { q: { page: 1, limit: 5 } } });
    await waitFor(() => expect(result.current.data?.data).toHaveLength(5));
    expect(result.current.data?.meta).toMatchObject({ total: 24, total_page: 5 });
    rerender({ q: { page: 2, limit: 5 } });
    // the previous rows stay on screen while page 2 loads
    expect(result.current.data?.data[0].id).toBe(1);
    await waitFor(() => expect(result.current.data?.data[0].id).toBe(6));
  });

  it("the detail comes with its ETag; usages and folders load", async () => {
    const { wrapper } = setup();
    const detail = renderHook(() => useMediaAssetDetail(2), { wrapper });
    await waitFor(() => expect(detail.result.current.data).toBeDefined());
    expect(detail.result.current.data?.etag).toBe(etagOf(getMockDb().assets[1].updated_at));
    const usages = renderHook(() => useMediaUsages(15, { limit: 2 }), { wrapper });
    await waitFor(() => expect(usages.result.current.data?.data).toHaveLength(2));
    expect(usages.result.current.data?.meta.total).toBe(3);
    const folders = renderHook(() => useMediaFolders(), { wrapper });
    await waitFor(() => expect(folders.result.current.data?.data.length).toBeGreaterThan(5));
  });

  it("an undefined id is not fetched", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMediaAssetDetail(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("update: needs the ETag (no request without it), writes the new ETag into the cache and drops the pickers' lookups", async () => {
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(["schema-form", "media", 2], { id: 2 });
    const { result } = renderHook(() => useMutationUpdateMediaAsset(2), { wrapper });
    let called = 0;
    server.use(http.patch(`${API}/media/assets/2`, () => { called += 1; /* no return: falls through to the mock API */ }));
    await act(async () => {
      await expect(result.current.mutateAsync({ payload: { is_decorative: true }, etag: undefined })).rejects.toBeInstanceOf(MissingEtagError);
    });
    expect(called).toBe(0);
    const etag = etagOf(getMockDb().assets[1].updated_at);
    await act(async () => {
      await result.current.mutateAsync({ payload: { is_decorative: true }, etag });
    });
    const cached = queryClient.getQueryData<{ etag: string; data: { data: { is_decorative: boolean } } }>(mediaAssetKey(2));
    expect(cached?.etag).toBe(etagOf(getMockDb().assets[1].updated_at));
    expect(cached?.etag).not.toBe(etag);
    expect(cached?.data.data.is_decorative).toBe(true);
    expect(queryClient.getQueryState(["schema-form", "media", 2])?.isInvalidated).toBe(true);
  });

  it("delete and restore use the row's ETag; a used asset is refused with MEDIA_IN_USE", async () => {
    const { wrapper } = setup();
    const del = renderHook(() => useMutationDeleteMediaAsset(), { wrapper });
    await act(async () => {
      await expect(del.result.current.mutateAsync({ id: 1, etag: etagOf(getMockDb().assets[0].updated_at) })).rejects.toMatchObject({
        response: { status: 409, data: { code: "MEDIA_IN_USE", details: { total_usages: 1 } } },
      });
    });
    await act(async () => {
      await del.result.current.mutateAsync({ id: 5, etag: etagOf(getMockDb().assets[4].updated_at) });
    });
    expect(getMockDb().assets[4].deleted_at).not.toBeNull();
    const restore = renderHook(() => useMutationRestoreMediaAsset(), { wrapper });
    await act(async () => {
      await restore.result.current.mutateAsync({ id: 5, etag: etagOf(getMockDb().assets[4].updated_at) });
    });
    expect(getMockDb().assets[4].deleted_at).toBeNull();
  });

  it("creating a folder sends the Idempotency-Key and refreshes the tree", async () => {
    const { wrapper, queryClient } = setup();
    let key: string | null = null;
    server.use(
      http.post(`${API}/media/folders`, ({ request }) => {
        key = request.headers.get("Idempotency-Key");
        return HttpResponse.json({ success: true, data: { ...getMockDb().folders[0], id: 90 } }, { status: 201 });
      })
    );
    queryClient.setQueryData(["/media/folders"], { data: [] });
    const { result } = renderHook(() => useMutationCreateMediaFolder(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ payload: { name: "X" }, idempotencyKey: "k-1" });
    });
    expect(key).toBe("k-1");
    expect(queryClient.getQueryState(["/media/folders"])?.isInvalidated).toBe(true);
  });
});
