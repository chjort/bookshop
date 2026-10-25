async function call(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const json = (data) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const me = () => call("/api/admin/me");
export const login = (username, password) => call("/api/admin/login", json({ username, password }));
export const logout = () => call("/api/admin/logout", json({}));
export const catalogue = () => call("/api/admin/catalogue");

export function importCsv(file) {
  const form = new FormData();
  form.append("file", file);
  return call("/api/admin/import", {
    method: "POST",
    headers: { "X-Requested-With": "bookshop" },
    body: form,
  });
}

export const orders = (params) => call(`/api/admin/orders?${new URLSearchParams(params)}`);
export const order = (number) => call(`/api/admin/orders/${encodeURIComponent(number)}`);
export const orderAction = (number, action) =>
  call(`/api/admin/orders/${encodeURIComponent(number)}/${action}`, json({}));
