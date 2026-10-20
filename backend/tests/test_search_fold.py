import pytest

from app.search import fold, isbn_forms


@pytest.mark.parametrize(
    "a, b",
    [
        ("Århus", "Aarhus"),
        ("Møller", "Moeller"),
        ("José", "Jose"),
        ("Ærø", "aeroe"),
        ("ærø", "ÆRØ"),
    ],
)
def test_danish_and_accents_fold_the_same(a, b):
    assert fold(a) == fold(b)


def test_empty_and_whitespace_fold_to_empty():
    assert fold("") == fold("   ") == ""


def test_isbn_forms_convert_between_10_and_13():
    assert isbn_forms("0-306-40615-2") == ["0306406152", "9780306406157"]
    assert isbn_forms("978-0-306-40615-7") == ["9780306406157", "0306406152"]
    assert isbn_forms("tolkien") == []
