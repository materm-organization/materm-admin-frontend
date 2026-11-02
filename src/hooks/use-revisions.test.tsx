import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useMutationRestoreRevision, useRevision, useRevisions } from "@/hooks/use-revisions";
import { MissingEtagError } from "@/lib/etag";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { createTestQueryClient } from "@/test/render-app";
import { etagOf } from "@/mocks/mock-core";

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

describe("revisions hooks (generic over the entity)", () => {
  useMockApi();

  it("useRevisions reads the list of any save-live entity (string keys are encoded into the path)", async () => {
    const { wrapper } = setup();
    const media = renderHook(() => useRevisions("media/assets", 2), { wrapper });
    await waitFor(() => expect(media.result.current.data?.data).toHaveLength(4));
    expect(media.result.current.data?.data.map((r) => r.version)).toEqual([4, 3, 2, 1]);
    const menu = renderHook(() => useRevisions("menus", "main", { limit: 1, sort: "version" }), { wrapper });
    await waitFor(() => expect(menu.result.current.data?.data).toHaveLength(1));
    expect(menu.result.current.data?.data[0].version).toBe(1);
    expect(menu.result.current.data?.meta.total).toBe(2);
  });

  it("an unknown entity is a 404 (not an empty list)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRevisions("menus", "nope"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ response: { status: 404 } });
  });

  it("useRevision loads one version with its snapshot; disabled without an id", async () => {
    const { wrapper } = setup();
    const id = getMockDb().revisions["media/assets/2"][1].id;
    const one = renderHook(() => useRevision("media/assets", 2, id), { wrapper });
    await waitFor(() => expect(one.result.current.data?.data.snapshot).toBeDefined());
    expect(one.result.current.data?.data).toMatchObject({ version: 2, kind: "history", entity: { type: "media.assets", id: 2 } });
    const none = renderHook(() => useRevision("media/assets", 2, undefined), { wrapper });
    expect(none.result.current.fetchStatus).toBe("idle");
  });

  it("restore needs the ETag, sends If-Match and a note, and refreshes the list (a 'restore' row appears)", async () => {
    const { wrapper, queryClient } = setup();
    const list = renderHook(() => useRevisions("media/assets", 2), { wrapper });
    await waitFor(() => expect(list.result.current.data?.data).toHaveLength(4));
    const first = getMockDb().revisions["media/assets/2"][0];
    const { result } = renderHook(() => useMutationRestoreRevision("media/assets", 2), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ revId: first.id, etag: undefined })).rejects.toBeInstanceOf(MissingEtagError);
    });
    const etag = etagOf(getMockDb().assets[1].updated_at);
    await act(async () => {
      await result.current.mutateAsync({ revId: first.id, etag, changeNote: "back to the start" });
    });
    await waitFor(() => expect(list.result.current.data?.data).toHaveLength(5));
    expect(list.result.current.data?.data[0]).toMatchObject({ kind: "restore", change_note: "back to the start" });
    expect(queryClient.isFetching()).toBe(0);
  });
});
