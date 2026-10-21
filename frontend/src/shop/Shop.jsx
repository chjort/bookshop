import { useEffect, useRef, useState } from "react";
import { linkTo, navigate, useLocation } from "../router.js";
import { CapNote, addToCart, cartCount, maxQty, useCart } from "./cart.js";
import { CartPage, CheckoutPage, OrderPage } from "./Checkout.jsx";
import { count, price } from "./format.js";

const MAX_Q = 100;
const LOAD_ERROR = "We couldn't load the books. Please try again in a moment.";

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function listUrl({ q = "", genre = "", page = 1 }) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (genre) p.set("genre", genre);
  if (page > 1) p.set("page", page);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

export default function Shop() {
  const { path, search } = useLocation();
  const cart = useCart();
  const book = path.match(/^\/book\/(\d+)$/);
  const order = path.match(/^\/order\/([^/]+)$/);
  let page;
  if (book) page = <BookPage key={book[1]} id={book[1]} />;
  else if (order) page = <OrderPage key={order[1]} token={order[1]} />;
  else if (path === "/cart") page = <CartPage />;
  else if (path === "/checkout") page = <CheckoutPage />;
  else page = <BookList key={search} search={search} />;
  return (
    <>
      <header>
        <a {...linkTo("/")}><strong>probooks</strong></a>
        <SearchForm key={search} />
        <a {...linkTo("/cart")}>Cart ({cartCount(cart)})</a>
      </header>
      <main>{page}</main>
    </>
  );
}

function SearchForm() {
  const params = new URLSearchParams(window.location.search);
  const [q, setQ] = useState((params.get("q") || "").slice(0, MAX_Q).trim());
  return (
    <form role="search" aria-label="Search books" onSubmit={(e) => {
      e.preventDefault();
      navigate(listUrl({ q: q.trim(), genre: params.get("genre") || "" }));
    }}>
      <label htmlFor="q" className="visually-hidden">Search books</label>
      <input id="q" type="search" maxLength={100} placeholder="Search by title, author or ISBN"
        value={q} onChange={(e) => setQ(e.target.value)} />
      <button type="submit">Search</button>
    </form>
  );
}

function StockBadge({ inStock }) {
  return <span className="stock">{inStock ? "✓ In stock" : "– Sold out"}</span>;
}

function Cover({ url, title, alt = "" }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return <div className="cover placeholder" aria-hidden="true"><span>{title}</span></div>;
  }
  return <img className="cover" src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function BookList({ search }) {
  const params = new URLSearchParams(search);
  const q = (params.get("q") || "").slice(0, MAX_Q).trim(); // the API rejects longer q
  const genre = params.get("genre") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const [data, setData] = useState(null);
  const [genres, setGenres] = useState([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const heading = useRef(null);

  useEffect(() => {
    get("/api/genres").then((r) => r.status === 200 && setGenres(r.body), () => {});
  }, []);

  useEffect(() => {
    let live = true;
    const api = new URLSearchParams({ page });
    if (q) api.set("q", q);
    if (genre) api.set("genre", genre);
    get(`/api/books?${api}`).then(
      (r) => {
        if (!live) return;
        if (r.status !== 200) return setError(true);
        if (r.body.isbn_match) return navigate(`/book/${r.body.isbn_match}`);
        const last = Math.max(1, Math.ceil(r.body.total / r.body.page_size));
        if (!r.body.items.length && page > last) return navigate(listUrl({ q, genre, page: last }));
        setData(r.body);
      },
      () => live && setError(true),
    );
    return () => { live = false; };
  }, [q, genre, page, retry]);

  const title = q ? `Search results for "${q}"${genre ? ` in ${genre}` : ""}` : genre || "All books";
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  useEffect(() => {
    document.title = `${genre || "All books"}${page > 1 ? ` – page ${page}` : ""} – probooks`;
  }, [genre, page]);

  return (
    <div className="shop">
      <nav aria-label="Genres">
        <fieldset>
          <legend>Genres</legend>
          {[{ name: "", label: "All" }, ...genres.map((g) => ({ ...g, label: g.name }))].map((g) => (
            <label key={g.name || "all"}>
              <input type="radio" name="genre" checked={genre === g.name}
                onChange={() => navigate(listUrl({ q, genre: g.name }))} />
              {g.label}{g.count !== undefined && ` ${count(g.count)}`}
            </label>
          ))}
        </fieldset>
      </nav>
      <section>
        <h1 tabIndex={-1} ref={heading}>{title}</h1>
        <p aria-live="polite">
          {error ? "" : !data ? "Loading books …"
            : data.total ? `${count(data.total)} ${data.total === 1 ? "book" : "books"} found. Page ${page} of ${pages}.`
              : ""}
        </p>
        {error && (
          <p role="alert">{LOAD_ERROR} <button type="button" onClick={() => { setError(false); setRetry(retry + 1); }}>Try again</button></p>
        )}
        {data && data.total === 0 && <Empty q={q} genre={genre} />}
        {data && data.total > 0 && (
          <>
            <ul className="grid">
              {data.items.map((b) => (
                <li key={b.id} className={b.in_stock ? "card" : "card sold-out"}>
                  <a {...linkTo(`/book/${b.id}`)}>
                    <Cover url={b.cover_url} title={b.title} />
                    <span className="title">{b.title}</span>
                  </a>
                  {b.author && <span className="author">{b.author}</span>}
                  <span className="price">{price(b.price_cents)}</span>
                  <StockBadge inStock={b.in_stock} />
                </li>
              ))}
            </ul>
            <Pager page={page} pages={pages} url={(p) => listUrl({ q, genre, page: p })} />
          </>
        )}
      </section>
    </div>
  );
}

function Empty({ q, genre }) {
  if (q) {
    return (
      <div>
        <p>No books match "{q}".</p>
        <p>Try: checking the spelling · using fewer words, or just the author's last name · searching all genres</p>
        {genre && <a {...linkTo(listUrl({ q }))}>Search all genres</a>}{" "}
        <a {...linkTo("/")}>See all books</a>
      </div>
    );
  }
  if (genre) {
    return <p>There are no books in this genre right now. <a {...linkTo("/")}>See all books</a></p>;
  }
  return <p>The shop is being stocked. Check back soon.</p>;
}

function Pager({ page, pages, url }) {
  if (pages < 2) return null;
  const shown = [...new Set([1, pages, ...[-2, -1, 0, 1, 2].map((d) => page + d)])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  return (
    <nav aria-label="Pages">
      {page > 1 && <a {...linkTo(url(page - 1))}>‹ Previous</a>}{" "}
      {shown.map((p, i) => (
        <span key={p}>
          {i > 0 && p - shown[i - 1] > 1 && "… "}
          <a {...linkTo(url(p))} aria-label={`Go to page ${p}`}
            aria-current={p === page ? "page" : undefined}>{p}</a>{" "}
        </span>
      ))}
      {page < pages && <a {...linkTo(url(page + 1))}>Next ›</a>}
    </nav>
  );
}

function BookPage({ id }) {
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    get(`/api/books/${id}`).then(
      (r) => (r.status === 200 ? setBook(r.body) : setError(r.status === 404 ? "missing" : "other")),
      () => setError("other"),
    );
  }, [id]);
  useEffect(() => { if (book) document.title = `${book.title} – probooks`; }, [book]);

  if (error) {
    return (
      <p role="alert">
        {error === "missing" ? "This book is no longer available." : LOAD_ERROR}{" "}
        <a {...linkTo("/")}>See all books</a>
      </p>
    );
  }
  if (!book) return <p aria-live="polite">Loading books …</p>;
  return (
    <article className={book.in_stock ? "book" : "book sold-out"}>
      <a href="/" onClick={(e) => { e.preventDefault(); window.history.back(); }}>‹ Back to search</a>
      <Cover url={book.cover_url} title={book.title} alt={`Cover of ${book.title}`} />
      <h1>{book.title}</h1>
      {book.author && <p>by {book.author}</p>}
      <p className="price">{price(book.price_cents)}</p>
      <p><StockBadge inStock={book.in_stock} /></p>
      {book.in_stock ? <AddToCart book={book} /> : <p>Can't be added to the cart</p>}
      <dl>
        <dt>Genre:</dt><dd>{book.genre}</dd>
        <dt>ISBN:</dt><dd>{book.isbn}</dd>
        <dt>Shipping:</dt><dd>flat €3.00 (Denmark only)</dd>
      </dl>
    </article>
  );
}

function AddToCart({ book }) {
  const cart = useCart();
  const [added, setAdded] = useState(false);
  const inCart = cart.find((l) => l.book_id === book.id)?.qty || 0;
  const full = inCart >= maxQty(book.stock);
  return (
    <p>
      <button type="button" disabled={full} aria-describedby={full ? "cap-book" : undefined}
        onClick={() => { addToCart(book); setAdded(true); }}>
        Add to cart
      </button>{" "}
      <span aria-live="polite">
        {added && <>Added to cart · <a {...linkTo("/cart")}>Go to cart</a></>}
      </span>{" "}
      <CapNote id="cap-book" show={full} stock={book.stock} />
    </p>
  );
}
