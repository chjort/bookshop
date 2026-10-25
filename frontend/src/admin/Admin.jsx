import { useCallback, useEffect, useRef, useState } from "react";
import { linkTo, navigate, useLocation } from "../router.js";
import * as api from "./api.js";
import { OrderDetail, OrderList } from "./Orders.jsx";

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 50;
const GENERIC = "Something went wrong. Please try again.";
const num = (n) => n.toLocaleString("en-GB");

export default function Admin() {
  const { path } = useLocation();
  const [user, setUser] = useState(undefined); // undefined = checking
  const [notice, setNotice] = useState("");

  // Stable, so pages can list it as an effect dependency without refetching every render.
  const expired = useCallback(() => {
    setNotice("Your session has expired. Please log in again.");
    setUser(null);
  }, []);

  useEffect(() => {
    api.me().then((r) => setUser(r.status === 200 ? r.body.username : null), () => setUser(null));
  }, []);

  if (user === undefined) return null; // never flash admin content
  if (!user) {
    return (
      <Login
        notice={notice}
        onLogin={(name) => {
          setUser(name);
          setNotice("");
          if (path === "/admin/login") navigate("/admin");
        }}
      />
    );
  }

  const doLogout = async () => {
    await api.logout().catch(() => {});
    setNotice("You're logged out.");
    setUser(null);
    navigate("/admin/login");
  };

  return (
    <>
      <header>
        <strong>probooks · Admin</strong>
        <nav aria-label="Admin">
          <a href="/admin/import" onClick={(e) => { e.preventDefault(); navigate("/admin/import"); }}>
            Import
          </a>{" "}
          <a {...linkTo("/admin/orders")}>Orders</a>{" "}
          <button type="button" onClick={doLogout}>Log out</button>
        </nav>
      </header>
      <main>{page(path, expired)}</main>
    </>
  );
}

function page(path, expired) {
  const order = path.match(/^\/admin\/orders\/([^/]+)$/);
  if (order) return <OrderDetail key={order[1]} number={decodeURIComponent(order[1])} onExpired={expired} />;
  if (path === "/admin/orders") return <OrderList onExpired={expired} />;
  if (path === "/admin/import") return <ImportPage onExpired={expired} />;
  return <Home />;
}

function Login({ notice, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const banner = useRef(null);

  useEffect(() => { document.title = "Log in – Admin"; }, []);
  useEffect(() => { if (error) banner.current?.focus(); }, [error]);

  async function submit(e) {
    e.preventDefault();
    if (!username || !password) {
      setError(`Please fill in ${!username ? "Username" : "Password"}.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(username, password);
      if (r.status === 200) return onLogin(r.body.username);
      setError(r.status === 401 || r.status === 429 ? "Wrong username or password." : GENERIC);
    } catch {
      setError(GENERIC);
    } finally {
      setBusy(false);
    }
    setPassword("");
  }

  return (
    <main>
      <p><strong>probooks · Admin</strong></p>
      <h1>Log in</h1>
      {notice && !error && <p role="status">{notice}</p>}
      {error && <p role="alert" tabIndex={-1} ref={banner}>{error}</p>}
      <form onSubmit={submit} aria-busy={busy} noValidate>
        <label htmlFor="username">Username</label>
        <input id="username" autoComplete="username" value={username}
          onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type={show ? "text" : "password"} autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="button" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
        <button type="submit" disabled={busy}>{busy ? "Logging in …" : "Log in"}</button>
      </form>
    </main>
  );
}

function Home() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    document.title = "Admin";
    api.catalogue().then((r) => r.status === 200 && setInfo(r.body), () => {});
  }, []);
  const last = info?.last_import && new Date(info.last_import);
  return (
    <>
      <h1>Welcome</h1>
      <section aria-labelledby="cat-heading">
        <h2 id="cat-heading">Catalogue</h2>
        {info && (info.books === 0 ? (
          <p>No books yet. Import your first CSV file.</p>
        ) : (
          <p>
            {num(info.books)} books
            {last && <> · Last import: {last.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, {last.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
        ))}
        <a href="/admin/import" onClick={(e) => { e.preventDefault(); navigate("/admin/import"); }}>
          Import CSV
        </a>
      </section>
    </>
  );
}

function ImportPage({ onExpired }) {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    document.title = result ? "Import finished – Admin" : "Import catalogue – Admin";
  }, [result]);

  function choose(f) {
    setResult(null);
    setFileError("");
    setFile(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) return setFileError("The file must be a CSV file (.csv).");
    if (f.size === 0) return setFileError("The file is empty.");
    if (f.size > MAX_BYTES) return setFileError("The file is too large. The maximum is 5 MB.");
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    if (!file) return setFileError("Please choose a CSV file.");
    setBusy(true);
    try {
      const r = await api.importCsv(file);
      if (r.status === 401) return onExpired();
      if (r.status === 200) setResult({ ...r.body, filename: file.name });
      else setFileError(`${r.body.detail || GENERIC} Nothing was imported.`);
    } catch {
      setFileError(GENERIC);
    } finally {
      setBusy(false);
    }
    setFile(null);
    if (input.current) input.current.value = "";
  }

  return (
    <>
      <h1>Import catalogue</h1>
      <p>
        Upload your CSV file. Books are matched by ISBN: if the ISBN exists, the book is updated;
        otherwise it is created.
      </p>
      <p>
        Required columns: title, author, ISBN, genre, price, count. Upper/lower case doesn't
        matter. Comma or semicolon as separator.
      </p>
      <p id="import-shelf-help">
        <code>count</code> is the number of copies on your shelf. Copies in orders that are
        awaiting payment or paid are subtracted automatically.
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="csv">CSV file</label>
        <input id="csv" ref={input} type="file" accept=".csv,text/csv" disabled={busy}
          aria-describedby="import-file-hint import-shelf-help" aria-invalid={fileError ? "true" : undefined}
          onChange={(e) => choose(e.target.files[0])} />
        <p id="import-file-hint">.csv only, UTF-8, max 5 MB.</p>
        {fileError && <p role="alert">{fileError}</p>}
        <button type="submit" disabled={busy}>{busy ? "Importing …" : "Import"}</button>
      </form>
      <div role="status" aria-live="polite">
        {busy && <p role="status">Importing {file?.name} … This takes a few seconds.</p>}
        {result && <Result result={result} onAgain={() => setResult(null)} />}
      </div>
    </>
  );
}

function Result({ result, onAgain }) {
  const [page, setPage] = useState(0);
  const { created, updated, skipped, held_back: heldBack, errors, filename } = result;
  const banner =
    skipped === 0 ? "All rows were imported."
      : created + updated === 0 ? "No rows were imported."
        : `${num(skipped)} ${skipped === 1 ? "row was" : "rows were"} not imported. The rest were imported.`;
  const rows = errors.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <section>
      <h2>Import finished: {filename}</h2>
      <p role={skipped ? "alert" : undefined}>{banner}</p>
      <p>{num(created)} created · {num(updated)} updated · {num(skipped)} skipped</p>
      {heldBack > 0 && (
        <p>{num(heldBack)} {heldBack === 1 ? "copy" : "copies"} held back for open orders.</p>
      )}
      {skipped > 0 && (
        <>
          <table>
            <caption>Skipped rows ({num(skipped)})</caption>
            <thead>
              <tr><th scope="col">Row</th><th scope="col">ISBN</th><th scope="col">Reason</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.row_number}>
                  <td>{e.row_number}</td><td>{e.isbn}</td><td>{e.errors.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Showing {page * PAGE + 1}–{page * PAGE + rows.length} of {num(skipped)}{" "}
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>{" "}
            <button type="button" disabled={(page + 1) * PAGE >= skipped} onClick={() => setPage(page + 1)}>Next</button>
          </p>
        </>
      )}
      <button type="button" onClick={onAgain}>Import another file</button>
    </section>
  );
}
