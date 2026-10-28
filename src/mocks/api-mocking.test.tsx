import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiMocking } from "@/mocks/api-mocking";

describe("ApiMocking", () => {
  it("without NEXT_PUBLIC_API_MOCKING it renders its children untouched (no banner, no adapter)", () => {
    render(
      <ApiMocking>
        <p>real app</p>
      </ApiMocking>
    );
    expect(screen.getByText("real app")).toBeInTheDocument();
    expect(screen.queryByTestId("api-mock-banner")).not.toBeInTheDocument();
  });
});
