// Shared by the tests of the media / revisions / purge screens: the mock API on the MSW server, a fresh model per
// test. `useMockApi()` in a `describe` block.
import { beforeEach } from "vitest";

import { mockApiHandlers } from "@/mocks/handlers";
import { resetMockDb } from "@/mocks/mock-db";
import { server } from "@/test/msw-server";

export function useMockApi() {
  beforeEach(() => {
    resetMockDb();
    server.use(...mockApiHandlers);
  });
}
