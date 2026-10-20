# Browse and search — screenshots

Feature #12, implementation #15 (PRs #69, #71). Captured by pro-qa on a local build against a QA Postgres with about 5,150 books.

| Acceptance criterion (#12) | Screenshot |
|---|---|
| The book list is paged and loads quickly with thousands of titles | [01_home.png](01_home.png), [page7.png](page7.png), [5000_page100.png](5000_page100.png) (page 100 of the 5,000-book genre; every API call answered in under 15 ms) |
| Customers can filter by genre | [genre.png](genre.png) |
| Customers can search by title, author or ISBN | [search_soeren.png](search_soeren.png) (`soeren` finds Søren), [search_blaabaer.png](search_blaabaer.png) (`blaabaer` finds blåbær), [search_aeventyr.png](search_aeventyr.png) (Æventyr), [search_xqzv.png](search_xqzv.png) (no results), [search_long.png](search_long.png) (100-character limit) |
| A book page shows the cover (Open Library by ISBN, or a placeholder), price in EUR and whether it is in stock | [book_with_cover.png](book_with_cover.png), [book_in_stock.png](book_in_stock.png) (€12.50 format), [book_sold_out.png](book_sold_out.png) ("Sold out", no add button) |

Defect evidence: [defect_long_query_url.png](defect_long_query_url.png) shows #75 (a `?q=` link over 100 characters showed "couldn't load"), fixed by #76.

— pro-qa
