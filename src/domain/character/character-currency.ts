import { z } from "zod";

export const CurrencyDenominationSchema = z.enum([
  "copper",
  "silver",
  "electrum",
  "gold",
  "platinum",
]);

export type CurrencyDenomination = z.infer<typeof CurrencyDenominationSchema>;

export interface CharacterCurrency {
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
}

export const CURRENCY_DENOMINATIONS: readonly {
  key: CurrencyDenomination;
  label: string;
  abbreviation: string;
  copperValue: number;
}[] = [
  { key: "platinum", label: "Platino", abbreviation: "PPL", copperValue: 1_000 },
  { key: "gold", label: "Oro", abbreviation: "PO", copperValue: 100 },
  { key: "electrum", label: "Electro", abbreviation: "PE", copperValue: 50 },
  { key: "silver", label: "Plata", abbreviation: "PP", copperValue: 10 },
  { key: "copper", label: "Cobre", abbreviation: "PC", copperValue: 1 },
];

export class InvalidCurrencyTotalError extends Error {
  constructor(readonly totalInCopper: number) {
    super("El patrimonio debe ser una cantidad entera, segura y no negativa de monedas de cobre.");
    this.name = "InvalidCurrencyTotalError";
  }
}

export class InsufficientCurrencyError extends Error {
  constructor(readonly requestedInCopper: number, readonly availableInCopper: number) {
    super(`No hay fondos suficientes: se intentaron quitar ${requestedInCopper} PC y hay ${availableInCopper} PC.`);
    this.name = "InsufficientCurrencyError";
  }
}

function assertSafeCurrencyTotal(totalInCopper: number): void {
  if (!Number.isSafeInteger(totalInCopper) || totalInCopper < 0) {
    throw new InvalidCurrencyTotalError(totalInCopper);
  }
}

export function currencyTotalInCopper(currency: CharacterCurrency): number {
  const total = CURRENCY_DENOMINATIONS.reduce(
    (sum, denomination) => sum + currency[denomination.key] * denomination.copperValue,
    0,
  );
  assertSafeCurrencyTotal(total);
  return total;
}

export function currencyFromCopper(totalInCopper: number): CharacterCurrency {
  assertSafeCurrencyTotal(totalInCopper);
  let remaining = totalInCopper;
  const currency: CharacterCurrency = {
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 0,
    platinum: 0,
  };
  for (const denomination of CURRENCY_DENOMINATIONS) {
    currency[denomination.key] = Math.floor(remaining / denomination.copperValue);
    remaining %= denomination.copperValue;
  }
  return currency;
}

export function normalizeCurrency(currency: CharacterCurrency): CharacterCurrency {
  return currencyFromCopper(currencyTotalInCopper(currency));
}

export function adjustCurrency(
  currency: CharacterCurrency,
  denomination: CurrencyDenomination,
  quantity: number,
): CharacterCurrency {
  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    throw new InvalidCurrencyTotalError(quantity);
  }
  const currentTotal = currencyTotalInCopper(currency);
  const definition = CURRENCY_DENOMINATIONS.find((candidate) => candidate.key === denomination);
  if (!definition) throw new InvalidCurrencyTotalError(Number.NaN);
  const adjustment = quantity * definition.copperValue;
  if (!Number.isSafeInteger(adjustment)) throw new InvalidCurrencyTotalError(adjustment);
  const nextTotal = currentTotal + adjustment;
  if (nextTotal < 0) throw new InsufficientCurrencyError(-adjustment, currentTotal);
  return currencyFromCopper(nextTotal);
}
