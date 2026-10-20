const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
export const price = (cents) => eur.format(cents / 100);
export const count = (n) => n.toLocaleString("en-GB");
