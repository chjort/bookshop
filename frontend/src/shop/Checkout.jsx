import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { linkTo, navigate } from "../router.js";
import { CapNote, MAX_PER_TITLE, SHIPPING_CENTS, maxQty, readCart, subtotal, useCart, writeCart } from "./cart.js";
import { STATUS, price } from "./format.js";

const RATE_ERROR =
  "We can't fetch the bitcoin rate right now, so we can't work out the BTC amount. Please try again in a moment.";
const SUBMIT_ERROR = "Your order wasn't placed. Nothing has been charged or reserved. Please try again.";
const NOTICE_KEY = "probooks.cart-notice";
const DELIVERY_KEY = "probooks.delivery";
const IDEM_KEY = "probooks.idempotency-key";

const btc = (sats) => `${(sats / 1e8).toFixed(8)} BTC`;
const eurRate = (r) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(r));

async function call(url, options) {
  const res = await fetch(url, options);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function Totals({ lines }) {
  const sub = subtotal(lines);
  return (
    <dl className="totals">
      <dt>Subtotal</dt><dd>{price(sub)}</dd>
      <dt>Shipping (Denmark)</dt><dd>{price(SHIPPING_CENTS)}</dd>
      <dt>Total</dt><dd>{price(sub + SHIPPING_CENTS)}</dd>
    </dl>
  );
}

// Recheck each line against current stock and price; returns messages for what changed.
async function revalidate(lines) {
  const notes = [];
  const fresh = [];
  for (const line of lines) {
    const r = await call(`/api/books/${line.book_id}`);
    if (r.status === 404 || (r.status === 200 && r.body.stock === 0)) {
      notes.push(`‘${line.title}’ is now sold out and has been removed from the cart.`);
      continue;
    }
    if (r.status !== 200) {
      fresh.push(line);
      continue;
    }
    const next = { ...line, stock: r.body.stock, price_cents: r.body.price_cents };
    if (line.qty > maxQty(r.body.stock)) {
      next.qty = maxQty(r.body.stock);
      notes.push(`Only ${r.body.stock} of ‘${line.title}’ left. Quantity updated.`);
    }
    if (line.price_cents !== r.body.price_cents) {
      notes.push(`The price of ‘${line.title}’ has changed to ${price(r.body.price_cents)}.`);
    }
    fresh.push(next);
  }
  return { fresh, notes };
}

export function CartPage() {
  const lines = useCart();
  const [notes, setNotes] = useState(() => {
    const n = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return n ? [n] : [];
  });

  useEffect(() => {
    document.title = "Your cart – probooks";
    let live = true;
    revalidate(readCart()).then(({ fresh, notes: changed }) => {
      if (!live) return;
      if (changed.length) {
        writeCart(fresh);
        setNotes((n) => [...n, ...changed]);
      }
    });
    return () => { live = false; };
  }, []);

  const heading = useRef(null);
  const listRef = useRef(null);
  const setQty = (id, qty, typed = false) => {
    const line = readCart().find((l) => l.book_id === id);
    const max = maxQty(line.stock);
    const next = Math.max(1, Math.min(qty, max));
    if (typed && qty > max) {
      const msg = line.stock >= MAX_PER_TITLE
        ? `Max ${max} per order. Quantity set to ${max}.`
        : `Only ${max} in stock. Quantity set to ${max}.`;
      setNotes((n) => [...n.filter((x) => x !== msg), msg]);
    }
    writeCart(readCart().map((l) => (l.book_id === id ? { ...l, qty: next } : l)));
  };
  const remove = (id) => {
    const current = readCart();
    const index = current.findIndex((l) => l.book_id === id);
    writeCart(current.filter((l) => l.book_id !== id));
    // Keep keyboard focus: next line's Remove button, else the previous one, else the heading (#83)
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll("button.remove") || [];
      const target = buttons[Math.min(index, buttons.length - 1)] || heading.current;
      target?.focus();
    });
  };

  return (
    <>
      <h1 tabIndex={-1} ref={heading}>Your cart</h1>
      <div aria-live="polite">{notes.map((n) => <p key={n} role="status">{n}</p>)}</div>
      {lines.length === 0 ? (
        <p>Your cart is empty. <a {...linkTo("/")}>See all books</a></p>
      ) : (
        <>
          <ul className="cart" ref={listRef}>
            {lines.map((l) => (
              <li key={l.book_id}>
                <a {...linkTo(`/book/${l.book_id}`)}>{l.title}</a>
                {l.author && <span> by {l.author}</span>}
                <div>
                  <button type="button" aria-label={`Fewer of ${l.title}`} disabled={l.qty <= 1}
                    onClick={() => setQty(l.book_id, l.qty - 1)}>-</button>
                  <QtyInput line={l} onCommit={(n) => setQty(l.book_id, n, true)} />
                  <button type="button" aria-label={`More of ${l.title}`} disabled={l.qty >= maxQty(l.stock)}
                    aria-describedby={l.qty >= maxQty(l.stock) ? `cap-${l.book_id}` : undefined}
                    onClick={() => setQty(l.book_id, l.qty + 1)}>+</button>
                  <CapNote id={`cap-${l.book_id}`} show={l.qty >= maxQty(l.stock)} stock={l.stock} />
                </div>
                <span>{price(l.price_cents)}</span> <span>{price(l.price_cents * l.qty)}</span>{" "}
                <button type="button" className="remove" aria-label={`Remove ${l.title}`} onClick={() => remove(l.book_id)}>Remove</button>
              </li>
            ))}
          </ul>
          <Totals lines={lines} />
          <p>Price in BTC is shown in the next step</p>
          <a {...linkTo("/")}>‹ Continue shopping</a>{" "}
          <button type="button" onClick={() => navigate("/checkout")}>Go to checkout</button>
        </>
      )}
    </>
  );
}

// Typed quantities are applied on blur or Enter so the clamp message fits what was typed.
function QtyInput({ line, onCommit }) {
  const [text, setText] = useState(null);
  const commit = () => {
    if (text !== null) onCommit(parseInt(text, 10) || 1);
    setText(null);
  };
  return (
    <input type="number" aria-label={`Quantity of ${line.title}`} min={1} max={maxQty(line.stock)}
      value={text ?? line.qty} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
  );
}

const FIELDS = [
  { name: "name", label: "Full name", autoComplete: "name", missing: "Enter your name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email", missing: "Enter your email" },
  { name: "address_line", label: "Address", autoComplete: "address-line1", missing: "Enter your address",
    hint: "Street, number and floor if any" },
  { name: "address_line2", label: "Address line 2 (optional)", autoComplete: "address-line2", hint: "E.g. c/o" },
  { name: "postal_code", label: "Postal code", autoComplete: "postal-code", inputMode: "numeric",
    maxLength: 4, missing: "Enter your postal code" },
  { name: "city", label: "City", autoComplete: "address-level2", missing: "Enter your city" },
];

function validate(d) {
  const errors = {};
  for (const f of FIELDS) if (f.missing && !d[f.name]?.trim()) errors[f.name] = f.missing;
  if (!errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) errors.email = "Enter a valid email address";
  if (!errors.postal_code && !/^[0-9]{4}$/.test(d.postal_code.trim())) errors.postal_code = "Postal code must be 4 digits";
  return errors;
}

function idempotencyKey(lines, reset = false) {
  const cartSig = JSON.stringify(lines.map((l) => [l.book_id, l.qty]));
  const saved = JSON.parse(sessionStorage.getItem(IDEM_KEY) || "null");
  if (!reset && saved && saved.cart === cartSig) return saved.key;
  const key = crypto.randomUUID();
  sessionStorage.setItem(IDEM_KEY, JSON.stringify({ key, cart: cartSig }));
  return key;
}

export function CheckoutPage() {
  const lines = useCart();
  const [step, setStep] = useState(1);
  const [data, setData] = useState(() => JSON.parse(sessionStorage.getItem(DELIVERY_KEY) || "null") ||
    Object.fromEntries(FIELDS.map((f) => [f.name, ""])));
  const [errors, setErrors] = useState({});
  const summary = useRef(null);

  useEffect(() => {
    document.title = `Checkout – ${step === 1 ? "Delivery" : "Summary"} – probooks`;
  }, [step]);
  useEffect(() => { if (Object.keys(errors).length) summary.current?.focus(); }, [errors]);

  if (lines.length === 0) {
    return <><h1>Checkout</h1><p>Your cart is empty. <a {...linkTo("/")}>See all books</a></p></>;
  }

  if (step === 2) return <Summary lines={lines} delivery={data} onEdit={() => setStep(1)} />;

  const submit = (e) => {
    e.preventDefault();
    const found = validate(data);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      sessionStorage.setItem(DELIVERY_KEY, JSON.stringify(data));
      setStep(2);
    }
  };
  const count = Object.keys(errors).length;

  return (
    <>
      <h1>Checkout</h1>
      <p>Step 1 of 2: Delivery</p>
      {count > 0 && (
        <div role="alert" tabIndex={-1} ref={summary}>
          <p>Please fix {count} {count === 1 ? "error" : "errors"} in the form:</p>
          <ul>{Object.entries(errors).map(([k, v]) => <li key={k}><a href={`#${k}`}>{v}</a></li>)}</ul>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        {FIELDS.map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name}>{f.label}</label>
            <input id={f.name} type={f.type || "text"} autoComplete={f.autoComplete} inputMode={f.inputMode}
              maxLength={f.maxLength || 200} value={data[f.name]}
              aria-invalid={errors[f.name] ? "true" : undefined}
              aria-describedby={[f.hint && `${f.name}-hint`, errors[f.name] && `${f.name}-error`].filter(Boolean).join(" ") || undefined}
              onChange={(e) => setData({ ...data, [f.name]: e.target.value })} />
            {f.hint && <small id={`${f.name}-hint`}>{f.hint}</small>}
            {errors[f.name] && <p id={`${f.name}-error`}>! {errors[f.name]}</p>}
          </div>
        ))}
        <p>Country: Denmark (we only ship to Denmark)</p>
        <a {...linkTo("/cart")}>‹ Back to cart</a>{" "}
        <button type="submit">Continue</button>
      </form>
    </>
  );
}

function Summary({ lines, delivery, onEdit }) {
  const [rate, setRate] = useState(null);
  const [rateError, setRateError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    call("/api/rates/btc-eur").then(
      (r) => live && (r.status === 200 ? setRate(r.body) : setRateError(true)),
      () => live && setRateError(true),
    );
    return () => { live = false; };
  }, [retry]);

  const sub = subtotal(lines);
  const shipping = rate?.shipping_cents ?? SHIPPING_CENTS;
  const total = sub + shipping;
  const sats = rate && Math.ceil((total * 1e6) / Number(rate.eur_per_btc));
  const address = [delivery.name, delivery.address_line, delivery.address_line2,
    `${delivery.postal_code} ${delivery.city}`].filter((s) => s && s.trim()).join(", ");

  async function place() {
    setBusy(true);
    setFailed(false);
    const body = {
      lines: lines.map((l) => ({ book_id: l.book_id, qty: l.qty })),
      shipping: { ...delivery, address_line2: delivery.address_line2 || null },
    };
    try {
      const r = await call("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey(lines) },
        body: JSON.stringify(body),
      });
      if (r.status === 200 || r.status === 201) {
        writeCart([]);
        sessionStorage.removeItem(IDEM_KEY);
        sessionStorage.removeItem(DELIVERY_KEY);
        navigate(`/order/${r.body.token}`);
        return;
      }
      if (r.status === 409) {
        sessionStorage.setItem(NOTICE_KEY, "Nothing has been ordered yet. Check your cart and try again.");
        navigate("/cart");
        return;
      }
      if (r.status === 503) {
        setRate(null);
        setRateError(true);
      } else {
        if (r.status === 422 && r.body?.code === "idempotency_key_reused") idempotencyKey(lines, true);
        setFailed(true);
      }
    } catch {
      setFailed(true); // same key on retry, so no duplicate order
    }
    setBusy(false);
  }

  return (
    <>
      <h1>Checkout</h1>
      <p>Step 2 of 2: Summary</p>
      <section>
        <h2>Deliver to</h2> <button type="button" onClick={onEdit}>Edit</button>
        <p>{address}</p>
        <p>{delivery.email}</p>
      </section>
      <section>
        <h2>Items</h2> <a {...linkTo("/cart")}>Edit cart</a>
        <ul>
          {lines.map((l) => (
            <li key={l.book_id}>{l.qty} × {l.title} <span>{price(l.price_cents * l.qty)}</span></li>
          ))}
        </ul>
        <dl className="totals">
          <dt>Shipping (Denmark, flat rate)</dt><dd>{price(shipping)}</dd>
          <dt>Total</dt><dd>{price(total)}</dd>
          {rate && (
            <>
              <dt>Total in bitcoin</dt><dd>{btc(sats)}</dd>
            </>
          )}
        </dl>
        {rate && (
          <p>
            Rate: 1 BTC = {eurRate(rate.eur_per_btc)} · fetched at{" "}
            {new Date(rate.fetched_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            <br />The BTC amount is locked when you place the order.
          </p>
        )}
        {!rate && !rateError && <p role="status">Fetching bitcoin rate …</p>}
        {rateError && (
          <p role="alert" id="rate-error">
            {RATE_ERROR}{" "}
            <button type="button" onClick={() => { setRateError(false); setRetry(retry + 1); }}>Try again</button>
          </p>
        )}
      </section>
      <p>
        You pay with bitcoin from your own wallet after placing the order. The books are reserved for
        you when you place the order.
      </p>
      {failed && <p role="alert">{SUBMIT_ERROR}</p>}
      <button type="button" onClick={place} disabled={!rate || busy}
        aria-describedby={rateError ? "rate-error" : undefined}>
        {busy ? "Placing order …" : failed ? "Try again" : "Place order"}
      </button>
    </>
  );
}

export function CopyButton({ value, label }) {
  const [state, setState] = useState("");
  const copy = () => navigator.clipboard.writeText(value).then(
    () => setState("Copied"),
    () => setState("Couldn't copy. Select the text and copy it yourself."),
  );
  return (
    <>
      <button type="button" onClick={copy}>{label}</button> <span aria-live="polite">{state}</span>
    </>
  );
}

const STATUS_MESSAGE = {
  paid: "Payment received. We're getting your order ready.",
  shipped: "Your order is on its way.",
  cancelled: "This order was cancelled. Please don't send a payment.",
};

export function OrderPage({ token }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [qr, setQr] = useState(null);
  const heading = useRef(null);

  useEffect(() => {
    call(`/api/orders/${encodeURIComponent(token)}`).then(
      (r) => (r.status === 200 ? setOrder(r.body) : setError(r.status === 404 ? "missing" : "other")),
      () => setError("other"),
    );
  }, [token]);
  useEffect(() => {
    if (!order) return;
    document.title = `Order ${order.order_number} – probooks`;
    heading.current?.focus();
    if (order.status !== "awaiting_payment") return;
    QRCode.toDataURL(order.bip21_uri, { margin: 1, width: 192 }).then(setQr, () => {});
  }, [order]);

  if (error) {
    return (
      <p role="alert">
        {error === "missing" ? "We couldn't find this order." : "We couldn't load your order. Please try again in a moment."}
      </p>
    );
  }
  if (!order) return <p aria-live="polite">Loading your order …</p>;

  const ref = order.order_number;
  const address = [order.customer_name, order.address_line, order.address_line2,
    `${order.postal_code} ${order.city}`].filter(Boolean).join(", ");
  const summary = (
    <p>
      Order: {order.lines.map((l) => `${l.qty} × ${l.title}`).join(", ")} · Total {price(order.total_cents)}
      <br />Delivery: {address}
    </p>
  );
  const status = `Status: ${STATUS[order.status].label}`;

  if (order.status !== "awaiting_payment") {
    // Instructions are not rendered at all once the order is paid, shipped or cancelled.
    return (
      <article className="payment">
        <h1 tabIndex={-1} ref={heading}>Order {ref}</h1>
        <div role="status">
          <p>{status}</p>
          <p>{STATUS_MESSAGE[order.status]}</p>
        </div>
        {summary}
      </article>
    );
  }
  return (
    <article className="payment">
      <h1 tabIndex={-1} ref={heading}>✓ Thank you for your order</h1>
      <p role="status">{status}</p>
      <p><strong>Save this page. The payment details are not sent by email.</strong>{" "}
        <button type="button" onClick={() => window.print()}>Print / save page</button></p>

      <section aria-labelledby="ref-heading" className="reference">
        <h2 id="ref-heading">Payment reference</h2>
        <p className="ref">{ref}</p>
        <p>It is also your order number.</p>
        <CopyButton value={ref} label="Copy reference" />
      </section>

      <h2>How to pay</h2>
      <ol>
        <li>
          Send exactly this amount in bitcoin: <strong>{order.amount_btc} BTC</strong> (= {price(order.total_cents)}){" "}
          <CopyButton value={order.amount_btc} label="Copy amount" />
        </li>
        <li>
          To this bitcoin address: <code className="address">{order.btc_address}</code>{" "}
          <CopyButton value={order.btc_address} label="Copy bitcoin address" />
          {qr && (
            <p>
              <img src={qr} width={192} height={192}
                alt={`QR code with the bitcoin address ${order.btc_address} and the amount ${order.amount_btc} BTC`} />
              <br />Scan with your wallet. The QR code contains the address and the amount.
            </p>
          )}
        </li>
        <li>Add the payment reference {ref} as a note in your wallet, if it supports notes. It is also your order number.</li>
      </ol>

      <h2>What happens next?</h2>
      <p>
        The shop owner checks the payment by hand. This can take up to a few days. Your books are
        reserved for you meanwhile.
      </p>
      {summary}
    </article>
  );
}
