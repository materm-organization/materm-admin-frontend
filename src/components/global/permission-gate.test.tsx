import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionGate } from "@/components/global/permission-gate";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 7, permissions: [] as PermissionGrant[] } }));

vi.mock("@/hooks/use-auth", () => ({
  useFetchCurrentUser: () => ({ data: { data: me.current } }),
}));

const grant = (key: string, actions: string[]): PermissionGrant => ({
  id: 1,
  permission_key: key,
  name: key,
  description: "",
  category: "x",
  actions,
});

beforeEach(() => {
  me.current = {
    id: 7,
    permissions: [
      grant("cms.blog", ["read", "create", "update_own"]),
      grant("iam.users", ["read"]),
      grant("cms.pages", []),
    ],
  };
});

describe("PermissionGate", () => {
  it("shows the children when the action is granted", () => {
    render(
      <PermissionGate permission="cms.blog" action="create">
        <button>New post</button>
      </PermissionGate>
    );
    expect(screen.getByRole("button", { name: "New post" })).toBeInTheDocument();
  });

  it("hides them (renders the fallback) when it is not", () => {
    render(
      <PermissionGate permission="iam.users" action="create" fallback={<p>forbidden</p>}>
        <button>Add user</button>
      </PermissionGate>
    );
    expect(screen.queryByRole("button", { name: "Add user" })).not.toBeInTheDocument();
    expect(screen.getByText("forbidden")).toBeInTheDocument();
  });

  it("renders nothing by default when hidden", () => {
    const { container } = render(
      <PermissionGate permission="iam.users" action="delete">
        <button>Delete</button>
      </PermissionGate>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("actions: [] and a missing key are NO access", () => {
    render(
      <>
        <PermissionGate permission="cms.pages" action="read" fallback={<p>empty-grant</p>}>
          <p>pages</p>
        </PermissionGate>
        <PermissionGate permission="ops.audit" action="read" fallback={<p>no-key</p>}>
          <p>audit</p>
        </PermissionGate>
      </>
    );
    expect(screen.getByText("empty-grant")).toBeInTheDocument();
    expect(screen.getByText("no-key")).toBeInTheDocument();
    expect(screen.queryByText("pages")).not.toBeInTheDocument();
    expect(screen.queryByText("audit")).not.toBeInTheDocument();
  });

  it("several actions are any-of by default and all-of with match=all", () => {
    render(
      <>
        <PermissionGate permission="cms.blog" actions={["create", "delete"]}>
          <p>any</p>
        </PermissionGate>
        <PermissionGate permission="cms.blog" actions={["create", "delete"]} match="all">
          <p>all</p>
        </PermissionGate>
      </>
    );
    expect(screen.getByText("any")).toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();
  });

  it("update_own counts only for the creator (ownerId)", () => {
    render(
      <>
        <PermissionGate permission="cms.blog" action="update" ownerId={7}>
          <p>my post</p>
        </PermissionGate>
        <PermissionGate permission="cms.blog" action="update" ownerId={8}>
          <p>their post</p>
        </PermissionGate>
        <PermissionGate permission="cms.blog" action="update">
          <p>no owner</p>
        </PermissionGate>
      </>
    );
    expect(screen.getByText("my post")).toBeInTheDocument();
    expect(screen.queryByText("their post")).not.toBeInTheDocument();
    expect(screen.queryByText("no owner")).not.toBeInTheDocument();
  });

  it("mode=disable keeps a single element child but disables it", () => {
    render(
      <PermissionGate permission="iam.users" action="create" mode="disable">
        <button>Add user</button>
      </PermissionGate>
    );
    const button = screen.getByRole("button", { name: "Add user" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("mode=disable wraps several children in a disabled fieldset", () => {
    render(
      <PermissionGate permission="iam.users" action="create" mode="disable">
        <input aria-label="name" />
        <button>Save</button>
      </PermissionGate>
    );
    expect(screen.getByLabelText("name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("mode=disable leaves allowed children untouched", () => {
    render(
      <PermissionGate permission="cms.blog" action="create" mode="disable">
        <button>New post</button>
      </PermissionGate>
    );
    expect(screen.getByRole("button", { name: "New post" })).toBeEnabled();
  });
});
