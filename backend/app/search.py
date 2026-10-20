"""Search folding (ADR 0006): one function for stored text and queries."""

import re
import unicodedata

_DANISH = {"æ": "ae", "ø": "oe", "å": "aa"}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    s = "".join(_DANISH.get(c, c) for c in s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))  # é→e, ü→u
    return " ".join(re.sub(r"[\W_]+", " ", s).split())


def isbn_forms(q: str) -> list[str]:
    """ISBN-10 and ISBN-13 forms of q if it looks like an ISBN, else []."""
    s = q.replace("-", "").replace(" ", "").upper()
    if len(s) == 13 and s.isdigit():
        forms = [s]
        if s.startswith("978"):
            body = s[3:12]
            total = sum((10 - i) * int(c) for i, c in enumerate(body))
            check = (11 - total % 11) % 11
            forms.append(body + ("X" if check == 10 else str(check)))
        return forms
    if len(s) == 10 and s[:9].isdigit() and (s[9].isdigit() or s[9] == "X"):
        body = "978" + s[:9]
        total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body))
        return [s, body + str((10 - total % 10) % 10)]
    return []
