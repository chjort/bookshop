import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Shop from "./Shop.jsx";

const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) });
const card = (id, title, extra = {}) => ({
  id, title, author: "Author", genre: "Krimi", price_cents: 1250, in_stock: true,
  cover_url: null, ...extra,
});
let books;
let calls;

beforeEach(() => {
  window.history.pushState({}, "", "/");
  calls = [];
  books = () => ({ items: [card(1, "Alfa"), card(2, "Zebra", { in_stock: false, price_cents: 125000 })],
    page: 1, page_size: 24, total: 2, isbn_match: null });
  globalThis.fetch = vi.fn((url) => {
    calls.push(url);
    if (url === "/api/genres") return reply(200, [{ name: "Krimi", count: 2 }, { name: "Other", count: 1 }]);
    if (url.startsWith("/api/books/")) {
      const id = url.split("/").pop();
      return id === "2"
        ? reply(200, { ...card(2, "Zebra", { in_stock: false }), isbn: "9781502809193", stock: 0 })
        : reply(404, { code: "not_found" });
    }
    return reply(200, books(url));
  });
});
afterEach(cleanup);

test("list shows shop name, EUR prices and Sold out", async () => {
  render(<Shop />);
  expect(screen.getByText("probooks")).toBeTruthy();
  expect(await screen.findByRole("link", { name: "Alfa" })).toBeTruthy();
  expect(screen.getByText("€12.50")).toBeTruthy();
  expect(screen.getByText("€1,250.00")).toBeTruthy();
  expect(screen.getByText("– Sold out")).toBeTruthy();
  expect(screen.getByText("2 books found. Page 1 of 1.")).toBeTruthy();
});

test("search puts q in the URL and queries the API", async () => {
  render(<Shop />);
  await screen.findByRole("link", { name: "Alfa" });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: " aarhus " } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(window.location.search).toBe("?q=aarhus");
  expect(await screen.findByRole("heading", { name: 'Search results for "aarhus"' })).toBeTruthy();
  expect(calls).toContain("/api/books?page=1&q=aarhus");
});

test("genre filter narrows the list", async () => {
  render(<Shop />);
  fireEvent.click(await screen.findByLabelText("Krimi 2"));
  expect(window.location.search).toBe("?genre=Krimi");
  expect(await screen.findByRole("heading", { name: "Krimi" })).toBeTruthy();
  expect(calls).toContain("/api/books?page=1&genre=Krimi");
});

test("no results shows tips", async () => {
  books = () => ({ items: [], page: 1, page_size: 24, total: 0, isbn_match: null });
  window.history.pushState({}, "", "/?q=nothing");
  render(<Shop />);
  expect(await screen.findByText('No books match "nothing".')).toBeTruthy();
});

test("exact ISBN match opens the book page", async () => {
  books = () => ({ items: [card(2, "Zebra")], page: 1, page_size: 24, total: 1, isbn_match: 2 });
  window.history.pushState({}, "", "/?q=9781502809193");
  render(<Shop />);
  expect(await screen.findByRole("heading", { name: "Zebra" })).toBeTruthy();
  expect(window.location.pathname).toBe("/book/2");
  expect(screen.getByText("Can't be added to the cart")).toBeTruthy();
  expect(screen.getByText("flat €3.00 (Denmark only)")).toBeTruthy();
});

test("paging links keep the filters", async () => {
  books = () => ({ items: [card(1, "Alfa")], page: 3, page_size: 24, total: 24 * 10, isbn_match: null });
  window.history.pushState({}, "", "/?genre=Krimi&page=3");
  render(<Shop />);
  expect((await screen.findByLabelText("Go to page 3")).getAttribute("aria-current")).toBe("page");
  expect(screen.getByText("Next ›").getAttribute("href")).toBe("/?genre=Krimi&page=4");
  expect(screen.getByLabelText("Go to page 10")).toBeTruthy();
});

test("missing book says it is no longer available", async () => {
  window.history.pushState({}, "", "/book/99");
  render(<Shop />);
  expect((await screen.findByRole("alert")).textContent).toContain("This book is no longer available.");
});

test("load error offers Try again", async () => {
  books = null;
  globalThis.fetch = vi.fn((url) => (url === "/api/genres" ? reply(200, []) : reply(500, {})));
  render(<Shop />);
  expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load the books.");
});
