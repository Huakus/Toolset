import { describe, expect, it } from "vitest";
import {
  adjustCurrency,
  currencyFromCopper,
  currencyTotalInCopper,
  InsufficientCurrencyError,
  normalizeCurrency,
} from "../../src/domain/character/character-currency";

describe("character currency", () => {
  it("stores wealth as copper and decomposes it into the largest coins first", () => {
    expect(currencyFromCopper(1_199)).toEqual({
      platinum: 1,
      gold: 1,
      electrum: 1,
      silver: 4,
      copper: 9,
    });
    expect(currencyTotalInCopper({
      platinum: 1,
      gold: 1,
      electrum: 1,
      silver: 4,
      copper: 9,
    })).toBe(1_199);
  });

  it("normalizes arbitrary existing distributions without changing wealth", () => {
    expect(normalizeCurrency({
      platinum: 0,
      gold: 0,
      electrum: 0,
      silver: 0,
      copper: 1_199,
    })).toEqual({
      platinum: 1,
      gold: 1,
      electrum: 1,
      silver: 4,
      copper: 9,
    });
  });

  it("makes change automatically when removing a smaller denomination", () => {
    expect(adjustCurrency({
      platinum: 0,
      gold: 1,
      electrum: 0,
      silver: 0,
      copper: 0,
    }, "silver", -1)).toEqual({
      platinum: 0,
      gold: 0,
      electrum: 1,
      silver: 4,
      copper: 0,
    });
  });

  it("rejects removing more than the total available wealth", () => {
    expect(() => adjustCurrency({
      platinum: 0,
      gold: 0,
      electrum: 0,
      silver: 2,
      copper: 0,
    }, "gold", -1)).toThrow(InsufficientCurrencyError);
  });
});
