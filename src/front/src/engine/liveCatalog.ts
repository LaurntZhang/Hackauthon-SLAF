// Mirror of src/simulation/fixtures.py; the API currently has no catalogue route.
export const LIVE_ASSETS: Record<string, { label: string; type: string }> = {
  'FR-OAT-2034': { label: 'OAT 2034', type: 'bond' },
  'DE-BUND-2033': { label: 'Bund 2033', type: 'bond' },
  'EQ-LUMEN-SA': { label: 'Lumen SA', type: 'equity' },
  'EQ-NORDA-AG': { label: 'Norda AG', type: 'equity' },
  'EQ-VERDA-SE': { label: 'Verda SE', type: 'equity' },
  'MM-EUR-CASH': { label: 'Fonds monetaire Alpha', type: 'cash' },
  'XC-BTC-PERP': { label: 'Bitcoin perpetual', type: 'crypto' },
  'OP-EURO50-CALL': { label: 'Euro50 call', type: 'derivative' },
};
export const LIVE_COUNTERPARTIES = ['BNP-SECURITIES-SIM', 'SG-CIB-SIM', 'EXANE-SIM'];
