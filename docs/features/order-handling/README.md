# Order handling — screenshots

Feature #24, implementation #27 (PR #90, merged as 8b9d42d), design #89. Captured by pro-qa in headless Chromium on **val** at 8b9d42d (https://probooks.val.nygaardsvej41.dk), using two QA test orders: BH-T8AX6 (3 × A Christmas Carol, cancelled) and BH-G9WQ6 (1 × Alice's Adventures in Wonderland, taken through paid and shipped). Two shots marked *local* come from a local build of #90 at bafaca0 on a QA Postgres, because those states could not be produced on val without faking a failure or an extra order. No credentials, admin usernames or order-token URLs appear in any shot; the BTC address shown is the shop's public receiving address.

## Acceptance criteria (#24)

| Acceptance criterion | Screenshot |
|---|---|
| AC1: The admin order list shows each order's number, customer, total (EUR and BTC) and status | [list_all.png](list_all.png) (two awaiting orders, number, placed, customer, € and BTC total, status badge), [list_filter_awaiting.png](list_filter_awaiting.png) (status filter with counts), [list_shipped_cancelled.png](list_shipped_cancelled.png) (Shipped and Cancelled badges after the run) |
| AC2: The owner can mark an order paid, and then shipped | [detail_awaiting.png](detail_awaiting.png) (Match the payment box, Mark paid / Cancel order), [dialog_mark_paid.png](dialog_mark_paid.png) (confirm with the BTC amount), [detail_paid_banner.png](detail_paid_banner.png) ("Order BH-G9WQ6 marked paid."; paid orders can't be cancelled in R1), [dialog_mark_shipped.png](dialog_mark_shipped.png) (confirm with the ship-to address), [detail_shipped_banner.png](detail_shipped_banner.png) ("Order BH-G9WQ6 marked shipped."; "This order is complete.") |
| AC3: The owner can cancel an unpaid order, which releases its reserved stock | [dialog_cancel.png](dialog_cancel.png) ("its 3 books go back into stock"), [detail_cancelled_stock_released.png](detail_cancelled_stock_released.png) ("Order BH-T8AX6 cancelled. 3 books are back in stock."; progress shows "Stock released"). Verified on val: A Christmas Carol stock went up by 3 |
| AC4: Marking an order paid or shipped does not change stock | Verified on val: Alice's Adventures in Wonderland stock was the same before mark paid, after mark paid and after mark shipped (see [detail_paid_banner.png](detail_paid_banner.png), [detail_shipped_banner.png](detail_shipped_banner.png)) |

## Design states (#89)

| State | Screenshot |
|---|---|
| Stale tab: action on an order that already changed (409) | [stale_already_paid.png](stale_already_paid.png) ("This order was already marked paid (at …). Nothing was changed."), [stale_already_cancelled.png](stale_already_cancelled.png) ("This order was already cancelled (at …). Nothing was changed.") |
| Empty filter | [list_empty_filter.png](list_empty_filter.png) ("No shipped orders." + Show all orders) |
| Search with no match | [list_search_no_match.png](list_search_no_match.png) ("No order matches 'zz-no-such-qa'." + Clear search) |
| Unknown order number | [order_unknown.png](order_unknown.png) ("Order BH-ZZZZZ doesn't exist." + Back to orders) |
| List load error | [list_load_error.png](list_load_error.png) (*local*; "We couldn't load the orders. Please try again." + Try again) |
| Customer payment page, awaiting payment | [payment_awaiting.png](payment_awaiting.png) (reference, BTC amount, address, BIP21 QR) |
| Customer payment page, paid | [payment_paid.png](payment_paid.png) ("Payment received. We're getting your order ready."; no BTC address, amount or QR) |
| Customer payment page, shipped | [payment_shipped.png](payment_shipped.png) ("Your order is on its way."; no BTC fields) |
| Customer payment page, cancelled | [payment_cancelled.png](payment_cancelled.png) (*local*, fictional test customer; "This order was cancelled. Please don't send a payment."; no BTC fields) |

On val the public `GET /api/orders/{token}` returned null `btc_address`, `amount_sats`, `amount_btc` and `bip21_uri` for BH-G9WQ6 once it was paid and shipped.

Defects found and fixed during review: #91 (422 `{"detail"}`), #92 (dialog focus trap and return), #93 (long names). Deferred to R2: #94 (re-login banner), #95 (mobile cards), #101 (remaining `{"detail"}` errors).

— pro-qa
