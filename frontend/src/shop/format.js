const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
export const price = (cents) => eur.format(cents / 100);
export const count = (n) => n.toLocaleString("en-GB");

/** Satoshis to "0.00056250", exact (no floating point). */
export function btc(sats) {
  const s = String(sats).padStart(9, "0");
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23", timeZone: "Europe/Copenhagen",
});
/** "20 Oct 2026, 00:41" in Copenhagen time. */
export const dateTime = (iso) => when.format(new Date(iso));

/** One label map for the payment page and the admin (never raw database values). */
export const STATUS = {
  awaiting_payment: { label: "Awaiting payment", icon: "⏳" },
  paid: { label: "Paid", icon: "✓" },
  shipped: { label: "Shipped", icon: "✓✓" },
  cancelled: { label: "Cancelled", icon: "✕" },
};

export const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;
