import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { DEFAULT_ACTION_ORDER, type Matrix } from "@/components/protected/roles/matrix-model";
import { PermissionMatrix } from "@/components/protected/roles/permission-matrix";
import { renderWithIntl } from "@/test/render";
import type { ActionDef, RolePermission } from "@/types/iam";

const ACTIONS: ActionDef[] = DEFAULT_ACTION_ORDER.map((action) => ({ action, description: `${action} meaning` }));
const perm = (key: string, name: string, category: string, available: string[]): RolePermission => ({
  permission_id: 1,
  permission_key: key,
  name,
  description: "",
  category,
  available_actions: available,
  actions: [],
});
const PERMS = [
  perm("cms.pages", "Pages", "content", ["read", "create", "update", "delete", "publish"]),
  perm("cms.blog", "Blog posts", "content", ["read", "create", "update", "update_own"]),
  perm("iam.users", "Users", "iam", ["read", "create", "update", "delete"]),
];

function Harness({ initial = {}, readOnly = false }: { initial?: Matrix; readOnly?: boolean }) {
  const [matrix, setMatrix] = useState<Matrix>({ "cms.pages": [], "cms.blog": [], "iam.users": [], ...initial });
  return (
    <>
      <PermissionMatrix permissions={PERMS} actions={ACTIONS} matrix={matrix} onChange={setMatrix} readOnly={readOnly} />
      <output data-testid="state">{JSON.stringify(matrix)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as Matrix;

describe("PermissionMatrix", () => {
  it("other boxes of a row are locked until Read is ticked; unticking Read clears the row", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />);
    const create = screen.getByRole("checkbox", { name: "Pages: Create" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", "Tick Read first");

    await user.click(screen.getByRole("checkbox", { name: "Pages: Read" }));
    expect(create).toBeEnabled();
    await user.click(create);
    await user.click(screen.getByRole("checkbox", { name: "Pages: Delete" }));
    expect(state()["cms.pages"]).toEqual(["read", "create", "delete"]);

    await user.click(screen.getByRole("checkbox", { name: "Pages: Read" }));
    expect(state()["cms.pages"]).toEqual([]);
    expect(screen.getByRole("checkbox", { name: "Pages: Create" })).toBeDisabled();
  });

  it("an action the feature does not have is a dot, not a box", () => {
    renderWithIntl(<Harness />);
    expect(screen.queryByRole("checkbox", { name: "Users: Publish" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("row-iam.users")).getAllByText("Publish does not apply to this feature").length).toBe(1);
  });

  it("the row switch gives full access (Read included) and takes it away", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />);
    const sw = screen.getByRole("switch", { name: "Full access to Blog posts" });
    await user.click(sw);
    expect(state()["cms.blog"]).toEqual(["read", "create", "update", "update_own"]);
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(state()["cms.blog"]).toEqual([]);
  });

  it("a category box fills every row of the group at once; a column box adds one action everywhere", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Full access to every feature in Content" }));
    expect(state()["cms.pages"]).toHaveLength(5);
    expect(state()["cms.blog"]).toHaveLength(4);
    expect(state()["iam.users"]).toEqual([]);

    await user.click(screen.getByRole("checkbox", { name: "Create: all features" }));
    expect(state()["iam.users"]).toEqual(["read", "create"]);
  });

  it("read-only: nothing can be changed", async () => {
    renderWithIntl(<Harness readOnly initial={{ "cms.pages": ["read"] }} />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    for (const sw of screen.getAllByRole("switch")) expect(sw).toBeDisabled();
    expect(screen.getByText("This matrix is locked.")).toBeInTheDocument();
  });
});
