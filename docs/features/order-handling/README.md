# Order handling — screenshots

Feature #24, implementation #27 (PR #90, merged as 8b9d42d), design #89.

**QA sign-off** for AC1–AC4 and the #89 states is the val run by pro-qa on 8b9d42d (https://probooks.val.nygaardsvej41.dk) with two QA test orders: one cancelled (3 × A Christmas Carol, stock +3) and one taken through paid and shipped (1 × Alice's Adventures in Wonderland, stock unchanged). Results are on #29 and #28.

**Screenshots** were captured in headless Chromium from three runs, so that no image shows a real name, address or email:

- *val, 8b9d42d*: list and empty/no-match/unknown views only. They show the QA test name and a noreply email, no address.
- *local, 0ebade3*: every shot that shows a delivery address (detail pages, dialogs, stale warnings, payment pages) was re-captured on a local build of main at 0ebade3 against a fresh QA Postgres, with fictional orders BH-EYH7Y and BH-8R06W for "QA test pro-qa", Bogvej 1, 1234 Testby, a noreply email and a dummy BTC address. No new orders were placed on val for this.
- *local, bafaca0*: the list load error, from the #90 review run.

No credentials, admin usernames or order-token URLs appear in any shot.

## Acceptance criteria (#24)

| Acceptance criterion | Screenshot |
|---|---|
| AC1: The admin order list shows each order's number, customer, total (EUR and BTC) and status | [list_all.png](list_all.png) (*val*; two awaiting orders, number, placed, customer, € and BTC total, status badge), [list_filter_awaiting.png](list_filter_awaiting.png) (*val*; status filter with counts), [list_shipped_cancelled.png](list_shipped_cancelled.png) (*val*; Shipped and Cancelled badges after the run) |
| AC2: The owner can mark an order paid, and then shipped | [detail_awaiting.png](detail_awaiting.png) (*local 0ebade3*; Match the payment box, Mark paid / Cancel order), [dialog_mark_paid.png](dialog_mark_paid.png) (*local 0ebade3*; confirm with the BTC amount), [detail_paid_banner.png](detail_paid_banner.png) (*local 0ebade3*; "Order BH-8R06W marked paid."; paid orders can't be cancelled in R1), [dialog_mark_shipped.png](dialog_mark_shipped.png) (*local 0ebade3*; confirm with the ship-to address), [detail_shipped_banner.png](detail_shipped_banner.png) (*local 0ebade3*; "Order BH-8R06W marked shipped."; "This order is complete.") |
| AC3: The owner can cancel an unpaid order, which releases its reserved stock | [dialog_cancel.png](dialog_cancel.png) (*local 0ebade3*; "its 3 books go back into stock"), [detail_cancelled_stock_released.png](detail_cancelled_stock_released.png) (*local 0ebade3*; "Order BH-EYH7Y cancelled. 3 books are back in stock."; progress shows "Stock released"). Verified on val (8b9d42d): A Christmas Carol stock went up by 3; the local re-capture showed the same (17 → 20) |
| AC4: Marking an order paid or shipped does not change stock | Verified on val (8b9d42d): Alice's Adventures in Wonderland stock was the same before mark paid, after mark paid and after mark shipped (also unchanged in the local re-capture, 19 → 19; see [detail_paid_banner.png](detail_paid_banner.png), [detail_shipped_banner.png](detail_shipped_banner.png)) |

## Design states (#89)

| State | Screenshot |
|---|---|
| Stale tab: action on an order that already changed (409) | [stale_already_paid.png](stale_already_paid.png) (*local 0ebade3*; "This order was already marked paid (at …). Nothing was changed."), [stale_already_cancelled.png](stale_already_cancelled.png) (*local 0ebade3*; "This order was already cancelled (at …). Nothing was changed.") |
| Empty filter | [list_empty_filter.png](list_empty_filter.png) (*val*; "No shipped orders." + Show all orders) |
| Search with no match | [list_search_no_match.png](list_search_no_match.png) (*val*; "No order matches 'zz-no-such-qa'." + Clear search) |
| Unknown order number | [order_unknown.png](order_unknown.png) (*val*; "Order BH-ZZZZZ doesn't exist." + Back to orders) |
| List load error | [list_load_error.png](list_load_error.png) (*local bafaca0*; "We couldn't load the orders. Please try again." + Try again) |
| Customer payment page, awaiting payment | [payment_awaiting.png](payment_awaiting.png) (*local 0ebade3*; reference, BTC amount, address, BIP21 QR) |
| Customer payment page, paid | [payment_paid.png](payment_paid.png) (*local 0ebade3*; "Payment received. We're getting your order ready."; no BTC address, amount or QR) |
| Customer payment page, shipped | [payment_shipped.png](payment_shipped.png) (*local 0ebade3*; "Your order is on its way."; no BTC fields) |
| Customer payment page, cancelled | [payment_cancelled.png](payment_cancelled.png) (*local 0ebade3*; "This order was cancelled. Please don't send a payment."; no BTC fields) |

On val the public `GET /api/orders/{token}` returned null `btc_address`, `amount_sats`, `amount_btc` and `bip21_uri` for the paid-and-shipped QA test order once it was paid and shipped.

Defects found and fixed during review: #91 (422 `{"detail"}`), #92 (dialog focus trap and return), #93 (long names). Deferred to R2: #94 (re-login banner), #95 (mobile cards), #101 (remaining `{"detail"}` errors).

— pro-qa
