from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional


def _money(cents: int) -> str:
    return format(Decimal(cents) / Decimal(100), ".2f")


@dataclass(frozen=True)
class Account:
    id: int
    name: str
    kind: str
    currency: str
    opening_balance_cents: int
    created_at: str
    archived_at: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "currency": self.currency,
            "opening_balance": _money(self.opening_balance_cents),
            "created_at": self.created_at,
            "archived": self.archived_at is not None,
            "archived_at": self.archived_at,
        }


@dataclass(frozen=True)
class Transaction:
    id: int
    account_id: int
    date: str
    description: str
    amount_cents: int
    category_id: Optional[int]
    is_transfer: bool
    external_id: Optional[str]
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "date": self.date,
            "description": self.description,
            "amount": _money(self.amount_cents),
            "category_id": self.category_id,
            "is_transfer": self.is_transfer,
            "external_id": self.external_id,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class Category:
    id: int
    name: str
    parent_id: Optional[int]
    kind: str

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "parent_id": self.parent_id, "kind": self.kind}
