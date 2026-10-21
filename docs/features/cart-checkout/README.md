# Cart and bitcoin checkout — screenshots

Feature #18, implementation #21 (PRs #77, #79). Captured by pro-qa in headless Chromium on a local build of #79 at 0511c94, against main's order API on a QA Postgres with 150 books and the live Kraken BTC/EUR rate (dummy `BTC_ADDRESS`).

| Acceptance criterion (#18) | Screenshot |
|---|---|
| Customers can add, change and remove cart items | [cart_cap_stock9.png](cart_cap_stock9.png) (quantity controls, line and total), [cart_after_remove.png](cart_after_remove.png) (after removing two of three lines; focus moves to the next Remove button) |
| Customers cannot put more of a book in the cart or order than is in stock (cap = min(stock, 10)) | [book_sold_out.png](book_sold_out.png) (count 0: "Can't be added to the cart"), [book_cap_stock9.png](book_cap_stock9.png) / [cart_cap_stock9.png](cart_cap_stock9.png) ("ⓘ Only 9 in stock"), [book_cap_stock10.png](book_cap_stock10.png) / [cart_cap_stock10.png](cart_cap_stock10.png), [book_cap_stock11.png](book_cap_stock11.png) / [cart_cap_stock11.png](cart_cap_stock11.png), [book_cap_stock12.png](book_cap_stock12.png) / [cart_cap_stock12.png](cart_cap_stock12.png) ("ⓘ Max 10 per order") |
| Checkout asks for name, email and a Danish address | [checkout_errors.png](checkout_errors.png) (error summary; 4-digit postal code; country fixed to Denmark) |
| A flat shipping fee is added | [summary_qty10.png](summary_qty10.png) (10 × €17.50 = €175.00 + €3.00 = €178.00) |
| The summary shows the total in EUR and BTC at the current rate | [summary_qty10.png](summary_qty10.png) (0.00241169 BTC, rate and fetch time) |
| The confirmation shows the owner's bitcoin address and the order number to use as reference | [payment_qty10.png](payment_qty10.png) (reference, amount, address, BIP21 QR; no email promise in R1) |
| Placing the order reserves the stock (stock goes down at once) | Verified in the database: stock 10 → 0 after the order in [payment_qty10.png](payment_qty10.png); 20 parallel orders on a stock-1 book gave 1 order and 19 × 409 |
| The order is saved as awaiting payment. No private keys are stored | Verified in the database: status `awaiting_payment`, only `token_hash` and the public `BTC_ADDRESS` snapshot stored |

Defects found and fixed during review: #81 (qty above 10), #82 (control characters → 500), #83 (clamp message, focus after Remove), #86 (cap icon and `aria-describedby`).

— pro-qa
