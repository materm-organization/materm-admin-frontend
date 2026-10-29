import { describe, expect, it } from "vitest";

import { buildAuditTabQuery } from "@/services/audit.api";

describe("buildAuditTabQuery", () => {
  it("keeps only the tab shape, whatever the caller passes", () => {
    const query = buildAuditTabQuery({ entity_type: "iam.user", entity_id: 7, limit: 20, actor_id: 3, action: "x", keyword: "y" } as never);
    expect(query).toEqual({ entity_type: "iam.user", entity_id: 7, limit: 20 });
  });
});
