"""BTC/EUR rate: Kraken first, CoinGecko fallback, 60 s cache (ADR 0004 §1)."""

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

import httpx

log = logging.getLogger(__name__)

TTL = 60
FRESH = 5 * 60
TIMEOUT = 3.0


@dataclass
class Rate:
    eur_per_btc: Decimal
    source: str
    fetched_at: datetime
    fetched_mono: float


_cache: Rate | None = None


def _kraken() -> Decimal:
    r = httpx.get(
        "https://api.kraken.com/0/public/Ticker", params={"pair": "XBTEUR"}, timeout=TIMEOUT
    )
    r.raise_for_status()
    body = r.json()
    if body.get("error"):
        raise ValueError(body["error"])
    (ticker,) = body["result"].values()
    return Decimal(ticker["c"][0])


def _coingecko() -> Decimal:
    r = httpx.get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "bitcoin", "vs_currencies": "eur"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return Decimal(str(r.json()["bitcoin"]["eur"]))


SOURCES = [("kraken", _kraken), ("coingecko", _coingecko)]


def current_rate() -> Rate | None:
    """A fresh rate (< 5 min old), or None. Refetches when the cache is over 60 s old."""
    global _cache
    now = time.monotonic()
    if _cache is None or now - _cache.fetched_mono >= TTL:
        for name, fetch in SOURCES:
            try:
                value = fetch().quantize(Decimal("0.01"))
            except Exception as e:  # noqa: BLE001 - any failure means try the next source
                log.warning("BTC rate from %s failed: %s", name, e)
                continue
            if value > 0:
                _cache = Rate(value, name, datetime.now(UTC), now)
                break
    if _cache is None or now - _cache.fetched_mono >= FRESH:
        return None
    return _cache


def reset_cache():
    global _cache
    _cache = None
