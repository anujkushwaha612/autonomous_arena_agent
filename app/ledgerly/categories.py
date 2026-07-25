"""Category hierarchy and description-based categorisation rules."""
from __future__ import annotations

import re
import sqlite3
from typing import Any, Final

from ledgerly.models import Category, Rule

CATEGORY_KINDS: Final[frozenset[str]] = frozenset({"expense", "income", "transfer"})
DEFAULT_CATEGORIES: Final[tuple[tuple[str, str], ...]] = (
    ("Groceries", "expense"),
    ("Rent", "expense"),
    ("Transport", "expense"),
    ("Utilities", "expense"),
    ("Dining", "expense"),
    ("Salary", "income"),
    ("Transfers", "transfer"),
)


class CategoryError(ValueError):
    """Base class for category errors which are safe to show to a user."""


class CategoryNotFoundError(CategoryError):
    """Raised when a category id does not exist."""


class DuplicateCategoryError(CategoryError):
    """Raised when a category name is already in use."""


class InvalidCategoryError(CategoryError):
    """Raised when category input or hierarchy is invalid."""


class RuleError(ValueError):
    """Base class for categorisation-rule errors safe to show to a user."""


class RuleNotFoundError(RuleError):
    """Raised when a rule id does not exist."""


class InvalidRuleError(RuleError):
    """Raised when a rule's pattern, priority, or flags are invalid."""


class _Unset:
    """Private sentinel used to distinguish an omitted parent from ``None``."""


UNSET: Final[_Unset] = _Unset()


def seed_defaults(conn: sqlite3.Connection) -> list[Category]:
    """Create Ledgerly's standard top-level categories without duplicating them."""
    seeded: list[Category] = []
    for name, kind in DEFAULT_CATEGORIES:
        existing = _find_by_name(conn, name)
        if existing is not None:
            seeded.append(existing)
            continue
        seeded.append(create(conn, name=name, kind=kind))
    return seeded


def create(
    conn: sqlite3.Connection,
    name: str,
    kind: str,
    parent_id: int | None = None,
) -> Category:
    """Create a category, optionally one level below an existing root category."""
    clean_name = _validate_name(name)
    clean_kind = _validate_kind(kind)
    clean_parent_id = _validate_parent_for_new_category(conn, parent_id)
    _ensure_name_available(conn, clean_name)

    with conn:
        cursor = conn.execute(
            "INSERT INTO categories (name, parent_id, kind) VALUES (?, ?, ?)",
            (clean_name, clean_parent_id, clean_kind),
        )
    category = get(conn, int(cursor.lastrowid))
    if category is None:  # Defensive: the insert above must make this impossible.
        raise CategoryError("category could not be loaded after creation")
    return category


def get(conn: sqlite3.Connection, category_id: int) -> Category | None:
    """Return a category by id, or ``None`` when it does not exist."""
    clean_id = _validate_category_id(category_id)
    row = conn.execute(
        "SELECT id, name, parent_id, kind FROM categories WHERE id = ?", (clean_id,)
    ).fetchone()
    return _category_from_row(row) if row is not None else None


def list_all(conn: sqlite3.Connection) -> list[Category]:
    """Return all categories in stable parent/name order."""
    rows = conn.execute(
        """SELECT id, name, parent_id, kind
           FROM categories
           ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
                    parent_id ASC, name COLLATE NOCASE ASC, id ASC"""
    ).fetchall()
    return [_category_from_row(row) for row in rows]


def update(
    conn: sqlite3.Connection,
    category_id: int,
    *,
    name: str | None = None,
    kind: str | None = None,
    parent_id: int | None | _Unset = UNSET,
) -> Category:
    """Update supplied category fields while preserving the one-level hierarchy."""
    clean_id = _validate_category_id(category_id)
    current = get(conn, clean_id)
    if current is None:
        raise CategoryNotFoundError(f"category {clean_id} was not found")

    fields: list[str] = []
    values: list[Any] = []
    if name is not None:
        clean_name = _validate_name(name)
        _ensure_name_available(conn, clean_name, excluding_id=clean_id)
        fields.append("name = ?")
        values.append(clean_name)
    if kind is not None:
        fields.append("kind = ?")
        values.append(_validate_kind(kind))
    if not isinstance(parent_id, _Unset):
        clean_parent_id = _validate_parent_for_update(conn, clean_id, parent_id)
        fields.append("parent_id = ?")
        values.append(clean_parent_id)

    if fields:
        values.append(clean_id)
        with conn:
            conn.execute(
                f"UPDATE categories SET {', '.join(fields)} WHERE id = ?", values
            )

    category = get(conn, clean_id)
    if category is None:  # Defensive against unexpected concurrent deletion.
        raise CategoryNotFoundError(f"category {clean_id} was not found")
    return category


def delete(conn: sqlite3.Connection, category_id: int) -> None:
    """Delete a leaf category and clear its assignments from transactions."""
    clean_id = _validate_category_id(category_id)
    if get(conn, clean_id) is None:
        raise CategoryNotFoundError(f"category {clean_id} was not found")
    child = conn.execute(
        "SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1", (clean_id,)
    ).fetchone()
    if child is not None:
        raise InvalidCategoryError("a category with children cannot be deleted")

    with conn:
        # The original transactions schema predates category foreign keys. Do
        # not leave a dangling id when a user intentionally removes a category.
        conn.execute("UPDATE transactions SET category_id = NULL WHERE category_id = ?", (clean_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (clean_id,))


def add_rule(
    conn: sqlite3.Connection,
    pattern: str,
    category_id: int,
    priority: int,
    is_regex: bool = False,
) -> Rule:
    """Create a validated rule that assigns matching descriptions to a category."""
    clean_pattern = _validate_pattern(pattern, is_regex)
    clean_category_id = _require_category(conn, category_id).id
    clean_priority = _validate_priority(priority)
    clean_is_regex = _validate_is_regex(is_regex)
    with conn:
        cursor = conn.execute(
            """INSERT INTO rules (pattern, category_id, priority, is_regex)
               VALUES (?, ?, ?, ?)""",
            (clean_pattern, clean_category_id, clean_priority, 1 if clean_is_regex else 0),
        )
    rule = get_rule(conn, int(cursor.lastrowid))
    if rule is None:  # Defensive: the insert above must make this impossible.
        raise RuleError("rule could not be loaded after creation")
    return rule


def get_rule(conn: sqlite3.Connection, rule_id: int) -> Rule | None:
    """Return a rule by id, or ``None`` when it does not exist."""
    clean_id = _validate_rule_id(rule_id)
    row = conn.execute(
        "SELECT id, pattern, category_id, priority, is_regex FROM rules WHERE id = ?", (clean_id,)
    ).fetchone()
    return _rule_from_row(row) if row is not None else None


def list_rules(conn: sqlite3.Connection) -> list[Rule]:
    """Return rules ordered by descending priority and then creation order."""
    rows = conn.execute(
        """SELECT id, pattern, category_id, priority, is_regex
           FROM rules ORDER BY priority DESC, id ASC"""
    ).fetchall()
    return [_rule_from_row(row) for row in rows]


def match(conn: sqlite3.Connection, description: str) -> Category | None:
    """Return the category for the highest-priority rule matching ``description``."""
    clean_description = _validate_description(description)
    if not clean_description:
        return None
    for rule in list_rules(conn):
        if _rule_matches(rule, clean_description):
            return get(conn, rule.category_id)
    return None


def apply_rules(conn: sqlite3.Connection, *, only_uncategorised: bool = True) -> int:
    """Apply the best matching rule to transactions and return changed count.

    By default only transactions without a category are considered. Passing
    ``False`` deliberately re-evaluates categorised transactions as well.
    """
    if not isinstance(only_uncategorised, bool):
        raise RuleError("only_uncategorised must be a boolean")

    where = "WHERE category_id IS NULL" if only_uncategorised else ""
    rows = conn.execute(
        f"SELECT id, description, category_id FROM transactions {where} ORDER BY id ASC"
    ).fetchall()
    changed = 0
    with conn:
        for row in rows:
            category = match(conn, str(row["description"]))
            if category is None or row["category_id"] == category.id:
                continue
            conn.execute(
                "UPDATE transactions SET category_id = ? WHERE id = ?",
                (category.id, int(row["id"])),
            )
            changed += 1
    return changed


def _find_by_name(conn: sqlite3.Connection, name: str) -> Category | None:
    row = conn.execute(
        "SELECT id, name, parent_id, kind FROM categories WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    return _category_from_row(row) if row is not None else None


def _require_category(conn: sqlite3.Connection, category_id: int) -> Category:
    clean_id = _validate_category_id(category_id)
    category = get(conn, clean_id)
    if category is None:
        raise CategoryNotFoundError(f"category {clean_id} was not found")
    return category


def _validate_parent_for_new_category(conn: sqlite3.Connection, parent_id: int | None) -> int | None:
    if parent_id is None:
        return None
    parent = _require_category(conn, parent_id)
    if parent.parent_id is not None:
        raise InvalidCategoryError("categories may be nested only one level deep")
    return parent.id


def _validate_parent_for_update(
    conn: sqlite3.Connection, category_id: int, parent_id: int | None
) -> int | None:
    if parent_id is None:
        return None
    parent = _require_category(conn, parent_id)
    if parent.id == category_id:
        raise InvalidCategoryError("a category cannot be its own parent")
    if parent.parent_id is not None:
        raise InvalidCategoryError("categories may be nested only one level deep")
    child = conn.execute(
        "SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1", (category_id,)
    ).fetchone()
    if child is not None:
        raise InvalidCategoryError("categories may be nested only one level deep")
    return parent.id


def _ensure_name_available(
    conn: sqlite3.Connection, name: str, *, excluding_id: int | None = None
) -> None:
    query = "SELECT id FROM categories WHERE name = ? COLLATE NOCASE"
    params: list[Any] = [name]
    if excluding_id is not None:
        query += " AND id != ?"
        params.append(excluding_id)
    if conn.execute(query, params).fetchone() is not None:
        raise DuplicateCategoryError(f'category named "{name}" already exists')


def _validate_category_id(category_id: int) -> int:
    if isinstance(category_id, bool) or not isinstance(category_id, int) or category_id <= 0:
        raise CategoryNotFoundError("category was not found")
    return category_id


def _validate_name(name: str) -> str:
    if not isinstance(name, str):
        raise InvalidCategoryError("category name must be a string")
    cleaned = name.strip()
    if not cleaned:
        raise InvalidCategoryError("category name is required")
    return cleaned


def _validate_kind(kind: str) -> str:
    if not isinstance(kind, str) or kind not in CATEGORY_KINDS:
        allowed = ", ".join(sorted(CATEGORY_KINDS))
        raise InvalidCategoryError(f"category kind must be one of: {allowed}")
    return kind


def _validate_pattern(pattern: str, is_regex: bool) -> str:
    clean_is_regex = _validate_is_regex(is_regex)
    if not isinstance(pattern, str):
        raise InvalidRuleError("pattern must be a string")
    cleaned = pattern.strip()
    if not cleaned:
        raise InvalidRuleError("pattern is required")
    if clean_is_regex:
        try:
            re.compile(cleaned, re.IGNORECASE)
        except re.error as exc:
            raise InvalidRuleError(f"invalid regular expression: {exc}") from exc
    return cleaned


def _validate_priority(priority: int) -> int:
    if isinstance(priority, bool) or not isinstance(priority, int):
        raise InvalidRuleError("priority must be an integer")
    return priority


def _validate_is_regex(is_regex: bool) -> bool:
    if not isinstance(is_regex, bool):
        raise InvalidRuleError("is_regex must be a boolean")
    return is_regex


def _validate_rule_id(rule_id: int) -> int:
    if isinstance(rule_id, bool) or not isinstance(rule_id, int) or rule_id <= 0:
        raise RuleNotFoundError("rule was not found")
    return rule_id


def _validate_description(description: str) -> str:
    if not isinstance(description, str):
        raise RuleError("description must be a string")
    return description.strip()


def _rule_matches(rule: Rule, description: str) -> bool:
    if not rule.is_regex:
        return rule.pattern.casefold() in description.casefold()
    try:
        return re.search(rule.pattern, description, re.IGNORECASE) is not None
    except re.error:
        # add_rule validates regexes before they enter the table. If a database
        # was manually altered, matching remains safe rather than failing later.
        return False


def _category_from_row(row: sqlite3.Row) -> Category:
    return Category(
        id=int(row["id"]),
        name=str(row["name"]),
        parent_id=int(row["parent_id"]) if row["parent_id"] is not None else None,
        kind=str(row["kind"]),
    )


def _rule_from_row(row: sqlite3.Row) -> Rule:
    return Rule(
        id=int(row["id"]),
        pattern=str(row["pattern"]),
        category_id=int(row["category_id"]),
        priority=int(row["priority"]),
        is_regex=bool(int(row["is_regex"])),
    )
