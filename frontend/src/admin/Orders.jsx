import { useCallback, useEffect, useRef, useState } from "react";
import { linkTo, navigate, useLocation } from "../router.js";
import { CopyButton } from "../shop/Checkout.jsx";
import { STATUS, books, btc, dateTime, price } from "../shop/format.js";
import * as api from "./api.js";

const FILTERS = ["awaiting_payment", "paid", "shipped", "cancelled", ""];
const EMPTY = {
  awaiting_payment: "No orders awaiting payment.",
  paid: "No paid orders.",
  shipped: "No shipped orders.",
  cancelled: "No cancelled orders.",
};
const LOAD_ERROR = "We couldn't load the orders. Please try again.";

function StatusBadge({ status }) {
  const s = STATUS[status];
  return <span className={`badge badge-${status}`}><span aria-hidden="true">{s.icon}</span> {s.label}</span>;
}

/** /admin/orders?status=&q=&page= — status defaults to the work queue (D4); "all" is status= */
export function OrderList({ onExpired }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const status = params.has("status") ? params.get("status") : "awaiting_payment";
  const q = params.get("q") || "";
  const page = Number(params.get("page")) || 1;
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState(q);

  const go = (next) => {
    const p = new URLSearchParams({ status, q, ...next });
    if (!p.get("q")) p.delete("q");
    if (p.get("page") === "1" || !p.get("page")) p.delete("page");
    navigate(`/admin/orders?${p}`);
  };

  const load = useCallback(() => {
    setError(false);
    const p = { page };
    if (status) p.status = status;
    if (q) p.q = q;
    api.orders(p).then(
      (r) => (r.status === 401 ? onExpired() : r.status === 200 ? setData(r.body) : setError(true)),
      () => setError(true),
    );
  }, [status, q, page, onExpired]);

  useEffect(() => { document.title = "Orders – Admin – probooks"; }, []);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const all = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const count = (f) => (f ? data?.counts[f] : all) ?? "…";
  const items = data?.items || [];
  const from = (page - 1) * (data?.page_size || 25) + 1;

  let empty = null;
  if (data && items.length === 0 && page === 1) {
    if (q) empty = <p>No order matches ‘{q}’. <button type="button" onClick={() => { setQuery(""); go({ q: "", page: 1 }); }}>Clear search</button></p>;
    else if (all === 0) empty = <p>No orders yet. Orders appear here when customers check out.</p>;
    else empty = <p>{EMPTY[status]} <button type="button" onClick={() => go({ status: "", page: 1 })}>Show all orders</button></p>;
  }

  return (
    <>
      <h1>Orders</h1>
      <div role="group" aria-label="Filter by status">
        Status:{" "}
        {FILTERS.map((f) => (
          <button key={f || "all"} type="button" aria-pressed={status === f} onClick={() => go({ status: f, page: 1 })}>
            {f ? STATUS[f].label : "All"} ({count(f)})
          </button>
        ))}
      </div>
      <p aria-live="polite" className="visually-hidden">
        {data && `${count(status)} ${status ? `orders ${STATUS[status].label.toLowerCase()}` : "orders"}`}
      </p>
      <form role="search" onSubmit={(e) => { e.preventDefault(); go({ q: query.trim(), page: 1 }); }}>
        <label htmlFor="order-q">Find order</label>{" "}
        <input id="order-q" type="search" maxLength={100} placeholder="Order number, name or email"
          value={query} onChange={(e) => setQuery(e.target.value)} />{" "}
        <button type="submit">Find</button>
      </form>

      {error && <p role="alert">{LOAD_ERROR} <button type="button" onClick={load}>Try again</button></p>}
      {!data && !error && <p aria-busy="true">Loading orders …</p>}
      {empty}
      {items.length > 0 && (
        <table className="orders">
          <caption>
            Orders, {status ? STATUS[status].label.toLowerCase() : "all"}, {data.total} {data.total === 1 ? "order" : "orders"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Order no.</th><th scope="col">Placed</th><th scope="col">Customer</th>
              <th scope="col">Total</th><th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.order_number} onClick={(e) => e.target.closest("a") || navigate(`/admin/orders/${o.order_number}`)}>
                <td><a className="mono" {...linkTo(`/admin/orders/${o.order_number}`)}>{o.order_number}</a></td>
                <td>{dateTime(o.created_at)}</td>
                <td>{o.customer_name}<br />{o.email}</td>
                <td>{price(o.total_cents)}<br /><span className="mono">{btc(o.amount_sats)} BTC</span></td>
                <td><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.total > 0 && (
        <p>
          {items.length > 0 && <>Showing {from}–{from + items.length - 1} of {data.total}</>}
          {data.total > data.page_size && (
            <nav aria-label="Pages">
              <button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>‹ Prev</button>{" "}
              <button type="button" disabled={page * data.page_size >= data.total} onClick={() => go({ page: page + 1 })}>Next ›</button>
            </nav>
          )}
        </p>
      )}
    </>
  );
}

const ACTIONS = {
  paid: { title: (n) => `Mark order ${n} as paid?`, verb: "Mark paid", busy: "Marking paid …", done: "marked paid", from: "awaiting_payment", to: "paid" },
  ship: { title: (n) => `Mark order ${n} as shipped?`, verb: "Mark shipped", busy: "Marking shipped …", done: "marked shipped", from: "paid", to: "shipped" },
  cancel: { title: (n) => `Cancel order ${n}?`, verb: "Cancel order", busy: "Cancelling …", done: "cancelled", from: "awaiting_payment", to: "cancelled" },
};

/** /admin/orders/{order_number} */
export function OrderDetail({ number, onExpired }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null); // "missing" | "load"
  const [dialog, setDialog] = useState(null); // action key
  const [banner, setBanner] = useState(null); // { kind, text }
  const bannerRef = useRef(null);

  const load = useCallback(() => {
    setError(null);
    api.order(number).then(
      (r) => {
        if (r.status === 401) onExpired();
        else if (r.status === 200) setOrder(r.body);
        else setError(r.status === 404 ? "missing" : "load");
      },
      () => setError("load"),
    );
  }, [number, onExpired]);

  useEffect(() => { document.title = `Order ${number} – Admin – probooks`; }, [number]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (banner) bannerRef.current?.focus(); }, [banner]);

  const back = <a {...linkTo("/admin/orders")}>‹ Back to orders</a>;
  if (error === "missing") return <><p role="alert">Order {number} doesn't exist.</p>{back}</>;
  if (error) return <p role="alert">{LOAD_ERROR} <button type="button" onClick={load}>Try again</button></p>;
  if (!order) return <p aria-busy="true">Loading order …</p>;

  const copies = order.lines.reduce((n, l) => n + l.qty, 0);
  const address = [order.customer_name, order.address_line, order.address_line2,
    `${order.postal_code} ${order.city}`].filter(Boolean);

  async function run(action) {
    const a = ACTIONS[action];
    const r = await api.orderAction(order.order_number, action);
    if (r.status === 401) return onExpired();
    if (r.status === 200) {
      setOrder(r.body);
      setDialog(null);
      setBanner({ kind: "success", text: `Order ${order.order_number} ${a.done}.${action === "cancel" ? ` ${books(copies)} ${copies === 1 ? "is" : "are"} back in stock.` : ""}` });
      return;
    }
    if (r.status === 409 && r.body?.code === "invalid_transition") {
      setDialog(null);
      load();
      const current = r.body.current_status;
      const at = dateTime(r.body.status_changed_at);
      setBanner(current === a.to
        ? { kind: "info", text: `This order was already ${a.done} (at ${at}). Nothing was changed.` }
        : action === "cancel"
          ? { kind: "warning", text: `Paid orders can't be cancelled. The order is ${STATUS[current].label}.` }
          : { kind: "warning", text: `The order is ${STATUS[current].label} (since ${at}). Nothing was changed.` });
      return;
    }
    throw new Error(String(r.status));
  }

  const note = {
    paid: "Paid orders can't be cancelled in Release 1.",
    shipped: "This order is complete.",
    cancelled: order.cancelled_at && `This order was cancelled on ${dateTime(order.cancelled_at)}. Its stock was released.`,
  }[order.status];

  const steps = order.status === "cancelled"
    ? [["Placed", order.created_at, "Stock reserved"], ["Cancelled", order.cancelled_at, "Stock released"]]
    : [["Placed", order.created_at, "Stock reserved"], ["Paid", order.paid_at], ["Shipped", order.shipped_at]];

  return (
    <article className="order">
      {back}
      <h1>Order <span className="mono">{order.order_number}</span> <StatusBadge status={order.status} /></h1>
      <p>Placed {dateTime(order.created_at)}</p>
      {banner && (
        <p role={banner.kind === "warning" ? "alert" : "status"} className={`banner ${banner.kind}`} tabIndex={-1} ref={bannerRef}>
          {banner.text}
        </p>
      )}

      <section aria-labelledby="match-h" className="panel">
        <h2 id="match-h">Match the payment</h2>
        <dl>
          <dt>Payment reference</dt>
          <dd><span className="mono">{order.order_number}</span> <CopyButton value={order.order_number} label="Copy reference" /></dd>
          <dt>Amount due</dt>
          <dd>
            <span className="mono">{btc(order.amount_sats)} BTC</span> <CopyButton value={btc(order.amount_sats)} label="Copy amount" />
            <br />= {price(order.total_cents)} · rate 1 BTC = {price(Math.round(Number(order.rate_eur_per_btc) * 100))}, locked {dateTime(order.rate_at)}
          </dd>
          <dt>To address</dt>
          <dd><code className="address">{order.btc_address}</code></dd>
        </dl>
        <p>Look for an incoming payment of at least this amount to this address, with the reference as a note if the wallet shows one.</p>
      </section>

      <h2>Actions</h2>
      {order.status === "awaiting_payment" && (
        <p>
          <button type="button" className="primary" onClick={() => setDialog("paid")}>Mark paid</button>{" "}
          <button type="button" className="danger" onClick={() => setDialog("cancel")}>Cancel order</button>
        </p>
      )}
      {order.status === "paid" && (
        <p><button type="button" className="primary" onClick={() => setDialog("ship")}>Mark shipped</button></p>
      )}
      {note && <p>{note}</p>}

      <h2>Progress</h2>
      <ol className="progress">
        {steps.map(([label, at, extra]) => (
          <li key={label}>
            <span aria-hidden="true">{at ? "●" : "○"}</span> {label}, {at ? dateTime(at) : "not yet"}{extra && at ? `, ${extra}` : ""}
          </li>
        ))}
      </ol>

      <h2>Items</h2>
      <table>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.book_id}>
              <td>{l.qty} × {l.title} — {l.author} (ISBN {l.isbn})</td>
              <td>{price(l.unit_price_cents)}</td><td>{price(l.unit_price_cents * l.qty)}</td>
            </tr>
          ))}
          <tr><td colSpan={2}>Shipping (Denmark, flat rate)</td><td>{price(order.shipping_cents)}</td></tr>
          <tr><th scope="row" colSpan={2}>Total</th><td><strong>{price(order.total_cents)}</strong></td></tr>
        </tbody>
      </table>

      <div className="two-col">
        <section aria-labelledby="cust-h">
          <h2 id="cust-h">Customer</h2>
          <p>{order.customer_name}<br />{order.email} <CopyButton value={order.email} label="Copy email" /></p>
        </section>
        <section aria-labelledby="ship-h">
          <h2 id="ship-h">Deliver to</h2>
          <p>{address.map((line) => <span key={line}>{line}<br /></span>)}Denmark{" "}
            <CopyButton value={[...address, "Denmark"].join("\n")} label="Copy address" /></p>
        </section>
      </div>

      {dialog && (
        <ConfirmDialog
          action={dialog}
          title={ACTIONS[dialog].title(order.order_number)}
          onConfirm={() => run(dialog)}
          onClose={() => setDialog(null)}
        >
          {dialog === "paid" && (
            <>
              <p>Only do this when you have found the payment in your wallet:<br />
                <span className="mono">{btc(order.amount_sats)} BTC</span> ({price(order.total_cents)})</p>
              <p>You can't undo this.</p>
            </>
          )}
          {dialog === "ship" && <p>Ship to: {address.join(", ")}<br /><br />You can't undo this.</p>}
          {dialog === "cancel" && (
            <>
              <p>The order is cancelled and its {books(copies)} {copies === 1 ? "goes" : "go"} back into stock. You can't undo this.</p>
              <p>Only cancel if no payment has arrived.</p>
            </>
          )}
        </ConfirmDialog>
      )}
    </article>
  );
}

function ConfirmDialog({ action, title, children, onConfirm, onClose }) {
  const a = ACTIONS[action];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const safe = useRef(null);
  useEffect(() => { safe.current?.focus(); }, []);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  const close = () => { if (!busy) onClose(); };

  return (
    <div className="backdrop" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body"
        className="dialog" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <h2 id="dlg-title">{title}</h2>
        <div id="dlg-body">{children}</div>
        {failed && <p role="alert">The change wasn't saved. Please try again.</p>}
        <p>
          <button type="button" ref={safe} disabled={busy} onClick={onClose}>
            {action === "cancel" ? "Keep order" : "Go back"}
          </button>{" "}
          <button type="button" className={action === "cancel" ? "danger" : "primary"} disabled={busy} onClick={confirm}>
            {busy ? a.busy : failed ? "Try again" : a.verb}
          </button>
        </p>
      </div>
    </div>
  );
}
