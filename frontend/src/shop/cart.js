// Client-side cart in localStorage (ADR 0004). The server rechecks price and stock.
import { createElement as h, useEffect, useState } from "react";

const KEY = "probooks.cart";
const EVENT = "probooks-cart";

export function readCart() {
  try {
    const lines = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

export function writeCart(lines) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT));
}

export const MAX_PER_TITLE = 10; // same cap as the API (CartLineIn.qty <= 10, #81)
export const maxQty = (stock) => Math.min(stock, MAX_PER_TITLE);
export const maxHint = (stock) =>
  stock >= MAX_PER_TITLE ? `Max ${MAX_PER_TITLE} per order` : `Only ${stock} in stock`; // copy: spec PR #85

// line: {book_id, title, author, price_cents, cover_url, stock, qty}
export function addToCart(book) {
  const lines = readCart();
  const existing = lines.find((l) => l.book_id === book.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, maxQty(book.stock));
    existing.stock = book.stock;
  } else {
    lines.push({ book_id: book.id, title: book.title, author: book.author,
      price_cents: book.price_cents, cover_url: book.cover_url, stock: book.stock, qty: 1 });
  }
  writeCart(lines);
}

export function useCart() {
  const [lines, setLines] = useState(readCart);
  useEffect(() => {
    const update = () => setLines(readCart());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return lines;
}

export const SHIPPING_CENTS = 300; // display only; the server adds its own setting
export const subtotal = (lines) => lines.reduce((s, l) => s + l.price_cents * l.qty, 0);
export const cartCount = (lines) => lines.reduce((s, l) => s + l.qty, 0);

// Cap message with an info icon (spec PR #85). The live region is always rendered so
// screen readers announce the text when it appears; disabled controls point at its id.
export function CapNote({ id, show, stock }) {
  return h("span", { id, className: "cap-note", "aria-live": "polite" },
    show ? [h("span", { key: "i", className: "info-icon", "aria-hidden": "true" }, "ⓘ"),
      ` ${maxHint(stock)}`] : null);
}
