# Admin import — screenshots

Feature #6, implementation #9 (PR #65 API, PR #66 UI), ADR #47, design #45. Held-back stock: #110, #111, #112 (main at eca30a6).

**QA sign-off** for AC1–AC4 is the run by pro-qa on val at eca30a6 (https://probooks.val.nygaardsvej41.dk), which holds the owner's real stock of 150 books. Every val import was checked with a stock snapshot before and after: importing the owner's file changed no stock (150 books, 3484 copies). The one held-back check used a single fictional QA order for 1 × A Christmas Carol, which was cancelled afterwards. Stock went back to the same values and val has no open orders.

**Screenshots** were captured in headless Chromium from two runs:

- *val, eca30a6*: login form, 401, admin home, and the import page with the owner's book file. They show only book counts, import summaries and one fictional bad row (ISBN 123).
- *local, eca30a6*: a local build of main against a fresh QA Postgres, with fictional data only (`Book 0`… `Book 4999`, and a 7-row file of public-domain titles). These cover the wrong-password and thousands-of-rows cases, so no failed logins or test books were added on val.

No credentials, admin usernames, customer data, addresses or order-token URLs appear in any shot.

## Acceptance criteria (#6)

| Acceptance criterion | Screenshot |
|---|---|
| AC1: Only the owner can reach admin pages, after logging in | [val_logged_out_login_form.png](val_logged_out_login_form.png) (*val*; `/admin/import` logged out shows only the login form; `/admin` and `/admin/orders` do the same), [val_api_401_not_logged_in.png](val_api_401_not_logged_in.png) (*val*; `GET /api/admin/catalogue` logged out returns 401 `not_authenticated`; `/api/admin/me`, `/api/admin/orders` and `POST /api/admin/import` also return 401), [login_wrong_password.png](login_wrong_password.png) (*local*; "Wrong username or password.", same message for a wrong user or password), [val_admin_home_logged_in.png](val_admin_home_logged_in.png) (*val*; after the owner logs in: Import, Orders, Log out, "150 books") |
| AC2: Uploading the CSV creates or updates books by ISBN | [val_import_page.png](val_import_page.png) (*val*; "Books are matched by ISBN: if the ISBN exists, the book is updated; otherwise it is created.", plus the `count` help for held-back copies), [val_reimport_150_updated.png](val_reimport_150_updated.png) (*val*; the owner's file: "0 created · 150 updated · 0 skipped", no stock change), [import_5000_created.png](import_5000_created.png) (*local*; first import into an empty shop: "5,000 created"), [reimport_5000_updated.png](reimport_5000_updated.png) (*local*; same file again: "0 created · 5,000 updated"), [val_held_back_1.png](val_held_back_1.png) (*val*; with one open QA order: "1 copy held back for open orders.") |
| AC3: Rows that can't be imported are listed with the reason, and the rest are still imported | [val_skipped_row.png](val_skipped_row.png) (*val*; the owner's file plus one fictional bad row: "1 row was not imported. The rest were imported.", 150 updated · 1 skipped, row 152 / ISBN 123 / Invalid ISBN), [import_skipped_rows_reasons.png](import_skipped_rows_reasons.png) (*local*; 4 created · 3 skipped with "Count must be a whole number", "Price is missing", "Invalid ISBN") |
| AC4: A file with thousands of rows imports without timing out | [import_5000_created.png](import_5000_created.png), [reimport_5000_updated.png](reimport_5000_updated.png) (*local*; 5,000 rows, about 0.8 s each through the UI). Also covered in CI by `test_five_thousand_rows_import` |

Tests on main for #6: `backend/tests/test_admin_auth.py`, `backend/tests/test_admin_import.py`, `backend/tests/test_import_held_back.py`, `frontend/src/admin/Admin.test.jsx`. CI on eca30a6: https://github.com/chjort/bookshop/actions/runs/40229192372 (backend 86 passed, frontend 61 passed).

Open follow-ups, not part of the ACs: #99, #113 (cancel after a count below held stock), #114 (nested live regions).

— pro-qa
