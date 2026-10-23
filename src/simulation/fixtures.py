"""Données synthétiques du fonds « Alpha » : référentiel d'instruments et portefeuille initial."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from decimal import Decimal

from src.models.finguard_contracts import AssetType


@dataclass(frozen=True)
class Instrument:
    """Instrument du référentiel (données fictives)."""

    asset_id: str
    asset_type: AssetType
    issuer: str
    sector: str
    price: Decimal


INSTRUMENTS: dict[str, Instrument] = {
    i.asset_id: i
    for i in (
        Instrument("FR-OAT-2034", AssetType.BOND, "Etat francais (fictif)", "sovereign", Decimal("98.40")),
        Instrument("DE-BUND-2033", AssetType.BOND, "Etat allemand (fictif)", "sovereign", Decimal("101.20")),
        Instrument("EQ-LUMEN-SA", AssetType.EQUITY, "Lumen SA", "technology", Decimal("54.10")),
        Instrument("EQ-NORDA-AG", AssetType.EQUITY, "Norda AG", "industrials", Decimal("121.80")),
        Instrument("EQ-VERDA-SE", AssetType.EQUITY, "Verda SE", "energy", Decimal("33.25")),
        Instrument("MM-EUR-CASH", AssetType.CASH, "Fonds monetaire Alpha", "money_market", Decimal("1.00")),
        Instrument("XC-BTC-PERP", AssetType.CRYPTO, "Exchange offshore", "crypto", Decimal("61000")),
        Instrument("OP-EURO50-CALL", AssetType.DERIVATIVE, "Marche derive", "derivatives", Decimal("12.50")),
    )
}

CASH_ASSET = "MM-EUR-CASH"

INITIAL_POSITIONS: dict[str, Decimal] = {
    "FR-OAT-2034": Decimal("400000"),
    "DE-BUND-2033": Decimal("350000"),
    "EQ-LUMEN-SA": Decimal("300000"),
    "EQ-NORDA-AG": Decimal("250000"),
    "EQ-VERDA-SE": Decimal("200000"),
    CASH_ASSET: Decimal("8500000"),
}


def instrument_types() -> dict[str, AssetType]:
    """Vue minimale du référentiel exposée au Policy Engine."""
    return {asset_id: i.asset_type for asset_id, i in INSTRUMENTS.items()}


class Portfolio:
    """Portefeuille en valeur de marché (EUR) ; lecture pour les agents, écriture par le marché seul."""

    def __init__(self, aum: Decimal, positions: dict[str, Decimal] | None = None) -> None:
        self.aum = aum
        self._lock = threading.RLock()
        self._positions = dict(positions if positions is not None else INITIAL_POSITIONS)

    def position(self, asset_id: str) -> Decimal:
        """Valeur détenue sur un actif."""
        with self._lock:
            return self._positions.get(asset_id, Decimal(0))

    def positions(self) -> dict[str, Decimal]:
        """Copie des positions."""
        with self._lock:
            return dict(self._positions)

    def issuer_exposure(self, issuer: str, extra: Decimal = Decimal(0)) -> Decimal:
        """Part de l'encours sur un émetteur, après un achat éventuel."""
        with self._lock:
            held = sum((v for a, v in self._positions.items() if INSTRUMENTS[a].issuer == issuer), Decimal(0))
        return (held + extra) / self.aum

    def sector_exposure(self, sector: str, extra: Decimal = Decimal(0)) -> Decimal:
        """Part de l'encours sur un secteur, après un achat éventuel."""
        with self._lock:
            held = sum((v for a, v in self._positions.items() if INSTRUMENTS[a].sector == sector), Decimal(0))
        return (held + extra) / self.aum

    def apply_fill(self, asset_id: str, signed_amount: Decimal) -> None:
        """Applique une exécution : achat financé par le monétaire, vente créditée sur le monétaire."""
        with self._lock:
            self._positions[asset_id] = self._positions.get(asset_id, Decimal(0)) + signed_amount
            if asset_id != CASH_ASSET:
                self._positions[CASH_ASSET] = self._positions.get(CASH_ASSET, Decimal(0)) - signed_amount
