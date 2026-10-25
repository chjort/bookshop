import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Shop from "./Shop.jsx";
import { readCart, writeCart } from "./cart.js";

const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) });
const BOOK = { id: 7, title: "Alfa", author: "Karen Blixen", genre: "G", price_cents: 1250,
  in_stock: true, cover_url: null, isbn: "9798570901650", stock: 2 };
const ORDER = {
  order_number: "BH-7K3Q9", status: "awaiting_payment", total_cents: 2800,
  lines: [{ title: "Alfa", author: "Karen Blixen", unit_price_cents: 1250, qty: 2 }],
  amount_btc: "0.00043750", btc_address: "bc1qexample", bip21_uri: "bitcoin:bc1qexample?amount=0.00043750",
  customer_name: "Mette Hansen", address_line: "Nygårdsvej 41", address_line2: null,
  postal_code: "2100", city: "København Ø",
};
let routes;
let posted;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  posted = [];
  routes = {
    "/api/books/7": () => reply(200, BOOK),
    "/api/rates/btc-eur": () => reply(200, { eur_per_btc: "64000.00", source: "kraken",
      fetched_at: "2026-10-21T21:31:00Z", shipping_cents: 300 }),
    "/api/orders": (opts) => { posted.push(opts); return reply(201, { ...ORDER, token: "tok123" }); },
    "/api/orders/tok123": () => reply(200, ORDER),
  };
  globalThis.fetch = vi.fn((url, opts) => routes[url](opts));
});
afterEach(cleanup);

const go = (path) => window.history.pushState({}, "", path);
const cartLine = (qty = 1) => writeCart([{ book_id: 7, title: "Alfa", author: "Karen Blixen",
  price_cents: 1250, cover_url: null, stock: 2, qty }]);

test("add to cart from the book page, capped at stock", async () => {
  go("/book/7");
  render(<Shop />);
  const add = await screen.findByRole("button", { name: "Add to cart" });
  fireEvent.click(add);
  expect(screen.getByText("Cart (1)")).toBeTruthy();
  fireEvent.click(add);
  expect(screen.getByText("Cart (2)")).toBeTruthy();
  expect(add.disabled).toBe(true);
  expect(readCart()[0].qty).toBe(2);
});

test("cart changes quantity, shows totals with €3.00 shipping, and removes", async () => {
  cartLine(1);
  go("/cart");
  render(<Shop />);
  fireEvent.click(await screen.findByRole("button", { name: "More of Alfa" }));
  expect(screen.getByRole("button", { name: "More of Alfa" }).disabled).toBe(true);
  expect(screen.getByText("Only 2 in stock").closest("[aria-live=polite]")).toBeTruthy();
  expect(screen.getByText("€25.00", { selector: "dd" })).toBeTruthy();
  expect(screen.getByText("€3.00")).toBeTruthy();
  expect(screen.getByText("€28.00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove Alfa" }));
  expect(screen.getByText(/Your cart is empty/)).toBeTruthy();
});

test("cart drops quantity to current stock on load", async () => {
  cartLine(2);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock: 1 });
  go("/cart");
  render(<Shop />);
  expect(await screen.findByText("Only 1 of ‘Alfa’ left. Quantity updated.")).toBeTruthy();
  expect(readCart()[0].qty).toBe(1);
});

function fillDelivery(overrides = {}) {
  const values = { "Full name": "Mette Hansen", Email: "mette@example.dk", Address: "Nygårdsvej 41",
    "Postal code": "2100", City: "København Ø", ...overrides };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

test("checkout validates the Danish address", async () => {
  cartLine(1);
  go("/checkout");
  render(<Shop />);
  fillDelivery({ Email: "nope", "Postal code": "210" });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Please fix 2 errors in the form:");
  expect(alert.textContent).toContain("Enter a valid email address");
  expect(alert.textContent).toContain("Postal code must be 4 digits");
});

// "Place order" is rendered disabled until the BTC rate loads; clicking it earlier is a no-op.
async function placeOrderButton() {
  const button = await screen.findByRole("button", { name: "Place order" });
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

test("summary shows EUR and BTC, places the order once and opens the payment page", async () => {
  cartLine(2);
  go("/checkout");
  render(<Shop />);
  fillDelivery({ "Address line 2 (optional)": "c/o Jensen" });
  // 2800 cents at €64,000 = 43,750 sats
  expect(await screen.findByText("0.00043750 BTC")).toBeTruthy();
  expect(screen.getByText(/1 BTC = €64,000.00/)).toBeTruthy();
  expect(screen.getByText("Mette Hansen, Nygårdsvej 41, c/o Jensen, 2100 København Ø")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  expect(await screen.findByRole("heading", { name: "✓ Thank you for your order" })).toBeTruthy();
  expect(window.location.pathname).toBe("/order/tok123");
  expect(posted).toHaveLength(1);
  const body = JSON.parse(posted[0].body);
  expect(body.lines).toEqual([{ book_id: 7, qty: 2 }]);
  expect(body.shipping.address_line2).toBe("c/o Jensen");
  expect(posted[0].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(readCart()).toEqual([]);
  expect(screen.getByText("BH-7K3Q9")).toBeTruthy();
  expect(screen.getByText("bc1qexample")).toBeTruthy();
  expect(screen.getByText("0.00043750 BTC")).toBeTruthy();
});

test("a failed submit retries with the same idempotency key", async () => {
  cartLine(1);
  routes["/api/orders"] = (opts) => { posted.push(opts); return Promise.reject(new Error("timeout")); };
  go("/checkout");
  render(<Shop />);
  fillDelivery();
  fireEvent.click(await placeOrderButton());
  expect((await screen.findByRole("alert")).textContent).toContain("Your order wasn't placed.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(posted).toHaveLength(2));
  expect(posted[1].headers["Idempotency-Key"]).toBe(posted[0].headers["Idempotency-Key"]);
});

test("rate unavailable blocks placing the order", async () => {
  cartLine(1);
  routes["/api/rates/btc-eur"] = () => reply(503, { code: "rate_unavailable" });
  go("/checkout");
  render(<Shop />);
  fillDelivery();
  expect((await screen.findByRole("alert")).textContent).toContain("can't fetch the bitcoin rate");
  expect(screen.getByRole("button", { name: "Place order" }).disabled).toBe(true);
});

test("stock changed on submit returns to the cart with a notice", async () => {
  cartLine(1);
  routes["/api/orders"] = () => reply(409, { code: "stock_changed", lines: [{ book_id: 7, available: 0 }] });
  go("/checkout");
  render(<Shop />);
  fillDelivery();
  fireEvent.click(await placeOrderButton());
  expect(await screen.findByText("Nothing has been ordered yet. Check your cart and try again.")).toBeTruthy();
  expect(window.location.pathname).toBe("/cart");
});

test("cart caps each title at 10 per order even with more in stock (#81)", async () => {
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 12, qty: 10 }]);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock: 12 });
  go("/cart");
  render(<Shop />);
  expect((await screen.findByRole("button", { name: "More of Alfa" })).disabled).toBe(true);
  expect(screen.getByText("Max 10 per order")).toBeTruthy();
  const qty = screen.getByLabelText("Quantity of Alfa");
  fireEvent.change(qty, { target: { value: "11" } });
  fireEvent.blur(qty);
  expect(await screen.findByText("Max 10 per order. Quantity set to 10.")).toBeTruthy();
  expect(readCart()[0].qty).toBe(10);
});

test("book page stops adding at 10 per order (#81)", async () => {
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 12, qty: 9 }]);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock: 12 });
  go("/book/7");
  render(<Shop />);
  const add = await screen.findByRole("button", { name: "Add to cart" });
  fireEvent.click(add);
  expect(readCart()[0].qty).toBe(10);
  expect(add.disabled).toBe(true);
  expect(screen.getByText(/Max 10 per order/)).toBeTruthy();
});

test("typed quantity above stock is clamped with a message (#83)", async () => {
  cartLine(1);
  go("/cart");
  render(<Shop />);
  const qty = await screen.findByLabelText("Quantity of Alfa");
  fireEvent.change(qty, { target: { value: "9" } });
  fireEvent.blur(qty);
  expect(await screen.findByText("Only 2 in stock. Quantity set to 2.")).toBeTruthy();
  expect(readCart()[0].qty).toBe(2);
});

test("Remove moves focus to the next line, then to the heading (#83)", async () => {
  routes["/api/books/8"] = () => reply(200, { ...BOOK, id: 8, title: "Beta" });
  writeCart([
    { book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 2, qty: 1 },
    { book_id: 8, title: "Beta", author: "B", price_cents: 800, cover_url: null, stock: 2, qty: 1 },
  ]);
  go("/cart");
  render(<Shop />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Alfa" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove Beta" })));
  fireEvent.click(screen.getByRole("button", { name: "Remove Beta" }));
  await waitFor(() => expect(document.activeElement.textContent).toBe("Your cart"));
});

test("stock of exactly 10 shows 'Max 10 per order' in a polite live region (#81)", async () => {
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 10, qty: 10 }]);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock: 10 });
  go("/cart");
  render(<Shop />);
  const hint = await screen.findByText("Max 10 per order");
  expect(hint.closest("[aria-live]").getAttribute("aria-live")).toBe("polite");
});

test.each([
  [9, "Only 9 in stock"],
  [10, "Max 10 per order"],
  [11, "Max 10 per order"],
])("limit hint for stock %i is '%s' (#81)", async (stock, text) => {
  const qty = Math.min(stock, 10);
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock, qty }]);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock });
  go("/cart");
  render(<Shop />);
  expect((await screen.findByText(text)).closest("[aria-live=polite]")).toBeTruthy();
  expect(screen.getByRole("button", { name: "More of Alfa" }).disabled).toBe(true);
});

function expectDescribedByCapNote(button, text) {
  const id = button.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const note = document.getElementById(id);
  expect(note.getAttribute("aria-live")).toBe("polite");
  expect(note.textContent).toContain(text);
  const icon = note.querySelector(".info-icon");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(icon.textContent).toBe("ⓘ");
}

test("disabled + is described by the cap message with an info icon (#86)", async () => {
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 11, qty: 10 }]);
  routes["/api/books/7"] = () => reply(200, { ...BOOK, stock: 11 });
  go("/cart");
  render(<Shop />);
  const plus = await screen.findByRole("button", { name: "More of Alfa" });
  expect(plus.disabled).toBe(true);
  expectDescribedByCapNote(plus, "Max 10 per order");
  fireEvent.click(screen.getByRole("button", { name: "Fewer of Alfa" }));
  expect(plus.disabled).toBe(false);
  expect(plus.hasAttribute("aria-describedby")).toBe(false);
  expect(document.getElementById("cap-7").textContent).toBe("");
});

test("disabled 'Add to cart' is described by the cap message with an info icon (#86)", async () => {
  writeCart([{ book_id: 7, title: "Alfa", author: "A", price_cents: 1250, cover_url: null, stock: 2, qty: 2 }]);
  go("/book/7");
  render(<Shop />);
  const add = await screen.findByRole("button", { name: "Add to cart" });
  expect(add.disabled).toBe(true);
  expectDescribedByCapNote(add, "Only 2 in stock");
});

test("awaiting payment shows the instructions with a status line under the heading (#27)", async () => {
  go("/order/tok123");
  render(<Shop />);
  expect(await screen.findByRole("heading", { name: "✓ Thank you for your order" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "" }).textContent).toBe("Status: Awaiting payment");
  expect(screen.getByText("bc1qexample")).toBeTruthy();
});

test.each([
  ["paid", "Paid", "Payment received. We're getting your order ready."],
  ["shipped", "Shipped", "Your order is on its way."],
  ["cancelled", "Cancelled", "This order was cancelled. Please don't send a payment."],
])("a %s order hides the payment instructions and shows its status (#27)", async (status, label, message) => {
  routes["/api/orders/tok123"] = () => reply(200, { ...ORDER, status });
  go("/order/tok123");
  render(<Shop />);
  expect(await screen.findByRole("heading", { name: "Order BH-7K3Q9" })).toBeTruthy();
  const line = screen.getAllByRole("status").find((el) => el.textContent.startsWith("Status:"));
  expect(line.textContent).toContain(`Status: ${label}`);
  expect(line.textContent).toContain(message);
  expect(screen.queryByText("bc1qexample")).toBeNull();
  expect(screen.queryByText(/0\.00043750/)).toBeNull();
  expect(screen.queryByRole("heading", { name: "How to pay" })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText(/Nygårdsvej 41/)).toBeTruthy();
});
