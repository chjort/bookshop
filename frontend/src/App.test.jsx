import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";

beforeEach(() => {
  globalThis.fetch = vi.fn((url) =>
    Promise.resolve({
      status: url === "/api/admin/me" ? 401 : 200,
      json: () => Promise.resolve(
        url === "/api/genres" ? [] : { items: [], page: 1, page_size: 24, total: 0, isbn_match: null },
      ),
    }),
  );
});
afterEach(cleanup);

test("/ shows the shop", async () => {
  window.history.pushState({}, "", "/");
  render(<App />);
  expect(screen.getByRole("link", { name: "probooks" })).toBeTruthy();
  expect(await screen.findByText("The shop is being stocked. Check back soon.")).toBeTruthy();
});

test("/admin shows the admin login", async () => {
  window.history.pushState({}, "", "/admin");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
});
