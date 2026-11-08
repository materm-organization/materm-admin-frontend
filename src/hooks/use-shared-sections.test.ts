import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { SHARED_ROOT, sharedSectionQueryKey, writeThroughShared } from "@/hooks/use-shared-sections";

describe("shared sections query keys", () => {
  it("the detail key lives under the root, so invalidating the root refetches the detail too", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sharedSectionQueryKey(7), { etag: '"1"', data: { data: { id: 7, name: "A" } } });
    expect(sharedSectionQueryKey(7)[0]).toBe(SHARED_ROOT);
    await queryClient.invalidateQueries({ queryKey: [SHARED_ROOT] });
    expect(queryClient.getQueryState(sharedSectionQueryKey(7))?.isInvalidated).toBe(true);
  });

  it("writeThroughShared keeps the new ETag in the cache and marks the detail stale", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sharedSectionQueryKey(7), { etag: '"1"', data: { data: { id: 7, name: "A" } } });
    writeThroughShared(queryClient, 7, { data: { name: "B" }, etag: '"2"' });
    const cached = queryClient.getQueryData<{ etag: string; data: { data: { name: string } } }>(sharedSectionQueryKey(7));
    expect(cached).toMatchObject({ etag: '"2"', data: { data: { name: "B" } } });
    expect(queryClient.getQueryState(sharedSectionQueryKey(7))?.isInvalidated).toBe(true);
  });
});
