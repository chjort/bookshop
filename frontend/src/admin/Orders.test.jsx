import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Admin from "./Admin.jsx";

const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) });
let calls;
let handler;

const row = (n, extra = {}) => ({
  order_number: `BH-${n}`,
  created_at: "2026-10-20T10:00:00Z",
  customer_name: "Mette Hansen",
  email: "mette@example.dk",
  total_cents: 3600,
  amount_sats: 56250,
  status: "awaiting_payment",
  status_changed_at: "2026-10-20T10:00:00Z",
  ...extra,
});
const COUNTS = { awaiting_payment: 2, paid: 1, shipped: 0, cancelled: 0 };
const detail = (extra = {}) => ({
  ...row("7K3Q9"),
  lines: [
    { book_id: 1, isbn: "9788702000001", title: "Kongens Fald", author: "Johannes V. Jensen", unit_price_cents: 1500, qty: 2 },
    { book_id: 2, isbn: "9788702000002", title: "Sult", author: "Knut Hamsun", unit_price_cents: 300, qty: 1 },
  ],
  subtotal_cents: 3300,
  shipping_cents: 300,
  address_line: "Nygårdsvej 41",
  address_line2: null,
  postal_code: "2100",
  city: "København Ø",
  country: "DK",
  btc_address: "bc1qexampleaddress",
  rate_eur_per_btc: "64000.00",
  rate_source: "coingecko",
  rate_at: "2026-10-20T10:00:00Z",
  paid_at: null,
  shipped_at: null,
  cancelled_at: null,
  ...extra,
});

beforeEach(() => {
  calls = [];
  handler = () => reply(404, {});
  globalThis.fetch = vi.fn((url, opts = {}) => {
    calls.push({ url, opts });
    if (url === "/api/admin/me") return reply(200, { username: "admin" });
    return handler(url, opts);
  });
});
afterEach(cleanup);

const at = (path) => window.history.pushState({}, "", path);

test("list defaults to awaiting payment and shows number, customer, EUR + BTC total and status", async () => {
  handler = () => reply(200, { items: [row("7K3Q9"), row("2M8XA")], page: 1, page_size: 25, total: 2, counts: COUNTS });
  at("/admin/orders");
  render(<Admin />);
  const table = await screen.findByRole("table");
  expect(calls.some((c) => c.url === "/api/admin/orders?page=1&status=awaiting_payment")).toBe(true);
  const first = within(table).getAllByRole("row")[1];
  expect(first.textContent).toContain("BH-7K3Q9");
  expect(first.textContent).toContain("Mette Hansen");
  expect(first.textContent).toContain("€36.00");
  expect(first.textContent).toContain("0.00056250 BTC");
  expect(first.textContent).toContain("Awaiting payment");
  expect(screen.getByRole("button", { name: "Awaiting payment (2)" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "All (3)" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("Showing 1–2 of 2")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  expect(document.title).toBe("Orders – Admin – probooks");
});

test("search and filter go into the URL; pager shows past one page", async () => {
  handler = (url) => {
    const p = new URL(url, "http://x").searchParams;
    const page = Number(p.get("page"));
    return reply(200, { items: [row(page === 1 ? "AAAAA" : "BBBBB")], page, page_size: 25, total: 26, counts: { ...COUNTS, paid: 26 } });
  };
  at("/admin/orders");
  render(<Admin />);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: /^Paid/ }));
  await waitFor(() => expect(window.location.search).toBe("?status=paid"));
  fireEvent.change(screen.getByLabelText("Find order"), { target: { value: " mette " } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  await waitFor(() => expect(window.location.search).toBe("?status=paid&q=mette"));
  await waitFor(() => expect(calls.at(-1).url).toBe("/api/admin/orders?page=1&status=paid&q=mette"));
  const pager = await screen.findByRole("navigation", { name: "Pages" });
  expect(within(pager).getByRole("button", { name: "‹ Prev" }).disabled).toBe(true);
  fireEvent.click(within(pager).getByRole("button", { name: "Next ›" }));
  expect(await screen.findByText("Showing 26–26 of 26")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next ›" }).disabled).toBe(true);
});

test("empty states: no match, empty filter, nothing yet", async () => {
  const empty = { items: [], page: 1, page_size: 25, total: 0 };
  handler = () => reply(200, { ...empty, counts: COUNTS });
  at("/admin/orders?status=shipped");
  render(<Admin />);
  expect(await screen.findByText(/No shipped orders\./)).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(/Showing/)).toBeNull();
  cleanup();
  at("/admin/orders?q=zzz");
  render(<Admin />);
  expect(await screen.findByText(/No order matches ‘zzz’/)).toBeTruthy();
  cleanup();
  handler = () => reply(200, { ...empty, counts: { awaiting_payment: 0, paid: 0, shipped: 0, cancelled: 0 } });
  at("/admin/orders");
  render(<Admin />);
  expect(await screen.findByText(/No orders yet/)).toBeTruthy();
});

test("a 401 on the list returns to login with the expiry notice", async () => {
  handler = () => reply(401, { code: "not_authenticated" });
  at("/admin/orders");
  render(<Admin />);
  expect(await screen.findByText("Your session has expired. Please log in again.")).toBeTruthy();
});

test("mark paid: dialog copy, focus on Go back, POST JSON, success banner gets focus", async () => {
  handler = (url, opts) => {
    if (opts.method === "POST") {
      expect(url).toBe("/api/admin/orders/BH-7K3Q9/paid");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["X-Requested-With"]).toBeUndefined();
      return reply(200, detail({ status: "paid", paid_at: "2026-10-21T09:00:00Z" }));
    }
    return reply(200, detail());
  };
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
  const dlg = screen.getByRole("dialog", { name: "Mark order BH-7K3Q9 as paid?" });
  expect(dlg.textContent).toContain("Only do this when you have found the payment in your wallet:");
  expect(dlg.textContent).toContain("0.00056250 BTC (€36.00)");
  expect(dlg.textContent).toContain("You can't undo this.");
  expect(dlg.textContent).not.toMatch(/email/i);
  expect(document.activeElement.textContent).toBe("Go back");
  fireEvent.click(within(dlg).getByRole("button", { name: "Mark paid" }));
  const banner = await screen.findByText("Order BH-7K3Q9 marked paid.");
  // findByText resolves when the banner is in the DOM; the useEffect that focuses it can run
  // in a later scheduler task (#102), so wait for focus instead of asserting it on the same tick.
  await waitFor(() => expect(document.activeElement).toBe(banner));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Mark shipped" })).toBeTruthy();
  expect(screen.getByText("Paid orders can't be cancelled in Release 1.")).toBeTruthy();
  expect(document.title).toBe("Order BH-7K3Q9 – Admin – probooks");
});

test("mark shipped dialog shows the address", async () => {
  handler = () => reply(200, detail({ status: "paid", paid_at: "2026-10-21T09:00:00Z" }));
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark shipped" }));
  const dlg = screen.getByRole("dialog", { name: "Mark order BH-7K3Q9 as shipped?" });
  expect(dlg.textContent).toContain("Ship to: Mette Hansen, Nygårdsvej 41, 2100 København Ø");
  fireEvent.keyDown(dlg, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("cancel counts copies (sum of qty) in dialog and banner", async () => {
  handler = (url, opts) =>
    reply(200, opts.method === "POST" ? detail({ status: "cancelled", cancelled_at: "2026-10-21T09:00:00Z" }) : detail());
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
  const dlg = screen.getByRole("dialog", { name: "Cancel order BH-7K3Q9?" });
  expect(dlg.textContent).toContain("The order is cancelled and its 3 books go back into stock.");
  expect(dlg.textContent).toContain("Only cancel if no payment has arrived.");
  expect(document.activeElement.textContent).toBe("Keep order");
  fireEvent.click(within(dlg).getByRole("button", { name: "Cancel order" }));
  expect(await screen.findByText("Order BH-7K3Q9 cancelled. 3 books are back in stock.")).toBeTruthy();
  expect(screen.getByText(/This order was cancelled on .* Its stock was released\./)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
});

test("cancel with a single copy uses the singular", async () => {
  const one = { lines: [detail().lines[1]] };
  handler = (url, opts) =>
    reply(200, opts.method === "POST" ? detail({ ...one, status: "cancelled", cancelled_at: "2026-10-21T09:00:00Z" }) : detail(one));
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
  expect(screen.getByRole("dialog").textContent).toContain("its 1 book goes back into stock.");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel order" }));
  expect(await screen.findByText("Order BH-7K3Q9 cancelled. 1 book is back in stock.")).toBeTruthy();
});

test("409 closes the dialog, explains, and reloads the order", async () => {
  let gets = 0;
  handler = (url, opts) => {
    if (opts.method === "POST")
      return reply(409, { code: "invalid_transition", current_status: "paid", status_changed_at: "2026-10-21T09:00:00Z" });
    gets += 1;
    return reply(200, gets === 1 ? detail() : detail({ status: "paid", paid_at: "2026-10-21T09:00:00Z" }));
  };
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel order" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Paid orders can't be cancelled. The order is Paid.");
  await waitFor(() => expect(gets).toBe(2));
  expect(await screen.findByRole("button", { name: "Mark shipped" })).toBeTruthy();
});

test("a failed action keeps the dialog open with an error", async () => {
  handler = (url, opts) => (opts.method === "POST" ? reply(500, {}) : reply(200, detail()));
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark paid" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("unknown order shows not found", async () => {
  handler = () => reply(404, { code: "not_found" });
  at("/admin/orders/BH-ZZZZZ");
  render(<Admin />);
  expect((await screen.findByRole("alert")).textContent).toBe("Order BH-ZZZZZ doesn't exist.");
});

test("#92 dialog traps Tab, Esc works from anywhere, and focus returns to the opener", async () => {
  handler = () => reply(200, detail());
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  const opener = await screen.findByRole("button", { name: "Mark paid" });
  opener.focus();
  fireEvent.click(opener);
  const dlg = screen.getByRole("dialog");
  const back = within(dlg).getByRole("button", { name: "Go back" });
  const confirm = within(dlg).getByRole("button", { name: "Mark paid" });
  expect(document.activeElement).toBe(back);
  fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  confirm.focus();
  fireEvent.keyDown(document.activeElement, { key: "Tab" });
  expect(document.activeElement).toBe(back);
  // focus can't land behind the modal
  screen.getByRole("link", { name: "Orders" }).focus();
  expect(dlg.contains(document.activeElement)).toBe(true);
  // Esc from anywhere closes and returns focus to the button that opened the dialog
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  // Go back and a backdrop click also return focus
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep order" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel order" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
  fireEvent.click(document.querySelector(".backdrop"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mark paid" }));
});

test("#92 Esc is ignored while the action is running", async () => {
  let finish;
  handler = (url, opts) =>
    opts.method === "POST" ? new Promise((res) => { finish = res; }) : reply(200, detail());
  at("/admin/orders/BH-7K3Q9");
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark paid" }));
  expect(await screen.findByRole("button", { name: "Marking paid …" })).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  finish({ status: 200, json: () => Promise.resolve(detail({ status: "paid", paid_at: "2026-10-21T09:00:00Z" })) });
  expect(await screen.findByText("Order BH-7K3Q9 marked paid.")).toBeTruthy();
});

test("#93 long names and emails truncate with the full value in title", async () => {
  const name = "Mette ".repeat(20).trim();
  const email = `${"a".repeat(80)}@example.dk`;
  handler = () => reply(200, { items: [row("7K3Q9", { customer_name: name, email })], page: 1, page_size: 25, total: 1, counts: COUNTS });
  at("/admin/orders");
  render(<Admin />);
  await screen.findByRole("table");
  const nameEl = screen.getByTitle(name);
  expect(nameEl.className).toBe("trunc");
  expect(nameEl.textContent).toBe(name); // full text stays the accessible name
  expect(screen.getByTitle(email).className).toBe("trunc");
});
