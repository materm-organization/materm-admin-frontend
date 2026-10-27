import type { ColumnDef } from "@tanstack/react-table";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListPage } from "@/components/global/list/list-page";
import type { UseListParamsResult } from "@/hooks/use-list-params";
import { apiError } from "@/test/api-error";
import { renderWithIntl } from "@/test/render";

type Row = { id: number; name: string };
const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name", enableSorting: true },
  { accessorKey: "id", header: "ID" },
];
const rows: Row[] = [
  { id: 1, name: "Ann" },
  { id: 2, name: "Bob" },
];

function fakeList(overrides: Partial<UseListParamsResult> = {}): UseListParamsResult {
  return {
    params: { page: 1, limit: 10, keyword: "", sort: undefined, filters: {} },
    query: { page: 1, limit: 10 },
    activeFilterCount: 0,
    hasActiveFilters: false,
    setPage: vi.fn(),
    setLimit: vi.fn(),
    setKeyword: vi.fn(),
    setSort: vi.fn(),
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    ...overrides,
  };
}

const base = {
  columns,
  data: rows,
  isLoading: false,
  getRowId: (r: Row) => String(r.id),
  emptyTitle: "No things",
};

describe("ListPage", () => {
  it("renders rows and sends the keyword on submit", async () => {
    const list = fakeList();
    const user = userEvent.setup();
    renderWithIntl(<ListPage {...base} list={list} keywordPlaceholder="Search things" />);
    expect(screen.getByText("Ann")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search things" }), "  zed {Enter}");
    expect(list.setKeyword).toHaveBeenCalledWith("zed");
  });

  it("sorts server-side: only opted-in columns get a button, the sort goes to the URL state", async () => {
    const list = fakeList();
    const user = userEvent.setup();
    renderWithIntl(<ListPage {...base} list={list} />);
    expect(screen.getByRole("button", { name: "Name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ID" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(list.setSort).toHaveBeenCalledWith("name");
  });

  it("reflects the current sort with aria-sort and cycles to descending", async () => {
    const list = fakeList({ params: { page: 1, limit: 10, keyword: "", sort: "name", filters: {} } });
    const user = userEvent.setup();
    renderWithIntl(<ListPage {...base} list={list} />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(list.setSort).toHaveBeenCalledWith("-name");
  });

  it("no checkboxes unless a selection is given; with one, rows can be selected and a bulk bar appears", async () => {
    const { unmount } = renderWithIntl(<ListPage {...base} list={fakeList()} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    unmount();

    const onRowSelectionChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(
      <ListPage
        {...base}
        list={fakeList()}
        selection={{ rowSelection: { "1": true }, onRowSelectionChange, bulkActions: <button>Archive</button> }}
      />
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Actions for the selected rows" })).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(screen.getAllByRole("checkbox")[2]);
    expect(onRowSelectionChange).toHaveBeenCalledWith({ "1": true, "2": true });
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({});
  });

  it("a 403 read is the NoPermission state: no retry, no table", () => {
    renderWithIntl(
      <ListPage {...base} data={[]} list={fakeList()} error={apiError(403, { code: "FORBIDDEN" })} onRetry={vi.fn()} />
    );
    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("a server error shows the error state with Retry and the request id", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(
      <ListPage
        {...base}
        data={[]}
        list={fakeList()}
        error={apiError(500, { code: "INTERNAL_ERROR", request_id: "req-42" })}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText("Reference: req-42")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("empty without a filter shows the empty text and the create CTA", () => {
    renderWithIntl(<ListPage {...base} data={[]} list={fakeList()} emptyAction={<button>Create one</button>} />);
    expect(screen.getByText("No things")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create one" })).toBeInTheDocument();
  });

  it("empty WITH a filter shows 'no match' and Clear filters", async () => {
    const list = fakeList({
      params: { page: 1, limit: 10, keyword: "zzz", sort: undefined, filters: {} },
      activeFilterCount: 1,
      hasActiveFilters: true,
    });
    const user = userEvent.setup();
    renderWithIntl(<ListPage {...base} data={[]} list={list} />);
    const empty = screen.getByText("No items match your filters").closest("div") as HTMLElement;
    await user.click(within(empty).getByRole("button", { name: "Clear filters" }));
    expect(list.clearFilters).toHaveBeenCalledTimes(1);
  });

  it("shows the total and pages through the list", async () => {
    const list = fakeList();
    const user = userEvent.setup();
    renderWithIntl(
      <ListPage {...base} list={list} meta={{ total: 42, page: 1, limit: 10, total_page: 5 }} />
    );
    expect(screen.getByText("42 in total")).toBeInTheDocument();
    await user.click(within(screen.getByRole("navigation", { name: "pagination" })).getByText("2"));
    expect(list.setPage).toHaveBeenCalledWith(2);
  });
});
