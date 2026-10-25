import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Admin from "./Admin.jsx";

let routes;
const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) });

beforeEach(() => {
  window.history.pushState({}, "", "/admin");
  routes = { "/api/admin/me": () => reply(401, {}) };
  globalThis.fetch = vi.fn((url, opts) => routes[url](opts));
});
afterEach(cleanup);

const loggedIn = () => {
  routes["/api/admin/me"] = () => reply(200, { username: "admin" });
  routes["/api/admin/catalogue"] = () => reply(200, { books: 1243, last_import: null });
};

function fillLogin(user, pass) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: user } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: pass } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

test("not logged in shows the login page, not admin content", async () => {
  render(<Admin />);
  expect(await screen.findByRole("heading", { name: "Log in" })).toBeTruthy();
  expect(screen.queryByText("Welcome")).toBeNull();
});

test("wrong credentials show the generic error and clear the password", async () => {
  routes["/api/admin/login"] = () => reply(429, {});
  render(<Admin />);
  await screen.findByLabelText("Username");
  fillLogin("admin", "bad");
  expect((await screen.findByRole("alert")).textContent).toBe("Wrong username or password.");
  expect(screen.getByLabelText("Username").value).toBe("admin");
  expect(screen.getByLabelText("Password").value).toBe("");
});

test("successful login shows the admin home with the book count", async () => {
  routes["/api/admin/login"] = (opts) => {
    expect(JSON.parse(opts.body)).toEqual({ username: "admin", password: "pw" });
    loggedIn();
    return reply(200, { username: "admin" });
  };
  routes["/api/admin/catalogue"] = () => reply(200, { books: 1243, last_import: null });
  render(<Admin />);
  await screen.findByLabelText("Username");
  fillLogin("admin", "pw");
  expect(await screen.findByRole("heading", { name: "Welcome" })).toBeTruthy();
  expect(await screen.findByText(/1,243 books/)).toBeTruthy();
});

test("import uploads the file and lists skipped rows", async () => {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  routes["/api/admin/import"] = (opts) => {
    expect(opts.headers["X-Requested-With"]).toBe("bookshop");
    return reply(200, {
      created: 3912, updated: 61, skipped: 1,
      errors: [{ row_number: 5, isbn: "9781981618675", errors: ["Count must be a whole number"] }],
    });
  };
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File(["x"], "books.csv")] } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText("Import finished: books.csv")).toBeTruthy();
  expect(screen.getByText("1 row was not imported. The rest were imported.")).toBeTruthy();
  expect(screen.getByText("3,912 created · 61 updated · 1 skipped")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Count must be a whole number" })).toBeTruthy();
});

async function importWith(body) {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  routes["/api/admin/import"] = () => reply(200, { created: 0, updated: 2, skipped: 0, errors: [], ...body });
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File(["x"], "books.csv")] } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText("Import finished: books.csv");
}

test("held-back line is hidden when no copies were held back", async () => {
  await importWith({ held_back: 0 });
  expect(screen.queryByText(/held back for open orders/)).toBeNull();
});

test("held-back line is hidden when the API leaves held_back out", async () => {
  await importWith({});
  expect(screen.queryByText(/held back for open orders/)).toBeNull();
});

test("held-back line shows the API's held_back as-is (count 2, 3 held)", async () => {
  await importWith({ held_back: 2 });
  expect(screen.getByText("2 copies held back for open orders.")).toBeTruthy();
});

test("held-back line uses the singular for 1 copy", async () => {
  await importWith({ held_back: 1 });
  expect(screen.getByText("1 copy held back for open orders.")).toBeTruthy();
});

test("held-back line uses the plural and English number format, in the status region", async () => {
  await importWith({ held_back: 1204 });
  const line = screen.getByText("1,204 copies held back for open orders.");
  expect(line.closest('[role="status"][aria-live="polite"]')).toBeTruthy();
  expect(line.previousElementSibling.textContent).toBe("0 created · 2 updated · 0 skipped");
});

test("shelf-count help is linked to the file input", async () => {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  expect(input.getAttribute("aria-describedby")).toBe("import-file-hint import-shelf-help");
  const help = document.getElementById("import-shelf-help");
  expect(help.textContent).toBe(
    "count is the number of copies on your shelf. Copies in orders that are awaiting payment or paid are subtracted automatically.",
  );
  expect(help.querySelector("code").textContent).toBe("count");
});

test("file-level error says nothing was imported", async () => {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  routes["/api/admin/import"] = () => reply(422, { detail: "The file is empty." });
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File(["x"], "books.csv")] } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The file is empty. Nothing was imported.",
  );
});

test("non-CSV file is blocked before upload", async () => {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File(["x"], "books.xlsx")] } });
  expect(screen.getByRole("alert").textContent).toBe("The file must be a CSV file (.csv).");
});

test("expired session during import returns to login with a notice", async () => {
  loggedIn();
  window.history.pushState({}, "", "/admin/import");
  routes["/api/admin/import"] = () => reply(401, {});
  render(<Admin />);
  const input = await screen.findByLabelText("CSV file");
  fireEvent.change(input, { target: { files: [new File(["x"], "books.csv")] } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() =>
    expect(screen.getByText("Your session has expired. Please log in again.")).toBeTruthy(),
  );
});
