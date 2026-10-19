# Release plan: bookshop

Owner: pro-product-owner. Domain: nygaardsvej41.dk (registrar one.com). Hosting: Render, Frankfurt, one account.

## Product

A webshop where the owner sells their own stock of physical books to customers in Denmark.

- Thousands of titles across genres, kept in a CSV (title, author, ISBN, genre, EUR price, stock count). Covers come from Open Library by ISBN, with a placeholder when none is found.
- Prices are in EUR. Checkout shows the total in EUR and BTC at the current rate.
- There is no payment processing in the shop. The customer sends on-chain bitcoin to the owner's fixed address, using the order number as reference. The owner checks their wallet and marks the order paid by hand.
- Shipping is a flat fee, within Denmark only.
- The customer gets an email when the order is marked paid and again when it is marked shipped.
- UI language: Danish (confirmed by the user).
- Success for now: the shop is online and taking orders.

## Constraints

- The UI and customer emails are in Danish (confirmed by the user).
- Stock is reserved when an order is placed. Cancelling an unpaid order releases it. Marking paid or shipped does not change stock. Checkout cannot order more than is in stock.

- Python backend, React frontend, GitHub, trunk-based, all CI green, only the user merges.
- Environments dev, val, prd on Render (Frankfurt). One paid Postgres instance with separate databases `shop_dev`, `shop_val`, `shop_prd` and one user each. dev and val run on the free web tier, prd always on. Target cost is about $13 a month.
- dev.nygaardsvej41.dk, val.nygaardsvej41.dk, nygaardsvej41.dk.
- No private keys stored anywhere. The bitcoin address is configuration.

## Release 1: walking skeleton

Lean versions of every capability, deployed end to end through dev, val and prd and reachable on the domain.

1. **Delivery pipeline and environments**: CI on every PR, automatic deploy of main to dev, promotion to val and prd, `vN` tag on the prd commit, DNS for the three hostnames.
2. **Admin login and catalogue import**: one owner login, upload the CSV, upsert books by ISBN, report rows that were skipped and why.
3. **Browse and search**: book list with paging, genre filter, search by title, author or ISBN, a book page with cover, price and stock status.
4. **Cart and bitcoin checkout**: add to cart, enter name, email and Danish address, flat shipping fee, order summary in EUR and BTC, bitcoin address and order number shown, quantities capped at stock, stock reserved when the order is placed, and the order is saved as awaiting payment.
5. **Order handling**: the admin order list, marking an order paid and then shipped, and cancelling an unpaid order, which releases its reserved stock. Paid and shipped don't change stock.
6. **Order emails**: an email to the customer when the order is marked paid and when it is marked shipped.

## Release 2: ready for real customers

1. **Order received email**: the customer gets the payment instructions by email when they place the order.
2. **Expiring BTC quotes**: the BTC amount is locked for a set time, and the order shows when the quote expires.
3. **Stock updates by re-import**: importing the CSV again updates prices and counts, and books missing from the file are hidden rather than deleted.
4. **Shop pages**: about, terms of sale, privacy policy (GDPR), and contact.
5. **Out-of-stock handling**: clear out-of-stock display in lists and book pages, and the cart warns when stock changes.

## Release 3: nice to have

1. **Lightning payments**: an optional Lightning invoice at checkout.
2. **Order status page**: the customer can look up their order status with the order number and email.
3. **Simple sales overview**: orders and revenue per week in the admin.
