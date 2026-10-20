"""Keep order tokens out of logs: /api/orders/{token} and /order/{token} are masked."""

import logging
import re

_TOKEN_PATH = re.compile(r"(/(?:api/orders|order)/)([A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]*")


def mask(text: str) -> str:
    return _TOKEN_PATH.sub(r"\1\2…", text)


class MaskOrderTokens(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(mask(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: mask(v) if isinstance(v, str) else v for k, v in record.args.items()}
        if isinstance(record.msg, str):
            record.msg = mask(record.msg)
        return True


def install():
    f = MaskOrderTokens()
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn", "app"):
        logger = logging.getLogger(name)
        if not any(isinstance(x, MaskOrderTokens) for x in logger.filters):
            logger.addFilter(f)
