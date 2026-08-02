export interface DiceTerm {
  sign: 1 | -1;
  count: number;
  sides: number | null;
}

export class InvalidDiceExpressionError extends Error {
  constructor(readonly expression: string) {
    super(`Invalid dice expression: ${expression}`);
    this.name = "InvalidDiceExpressionError";
  }
}

export function parseDiceExpression(expression: string): DiceTerm[] {
  const normalized = expression.replaceAll(" ", "").toLowerCase();
  if (normalized.length === 0) throw new InvalidDiceExpressionError(expression);
  const tokens = normalized.match(/[+-]?[^+-]+/g) ?? [];
  if (tokens.join("") !== normalized) throw new InvalidDiceExpressionError(expression);
  return tokens.map((token) => {
    const sign: 1 | -1 = token.startsWith("-") ? -1 : 1;
    const body = token.replace(/^[+-]/, "");
    const dice = body.match(/^(\d*)d(\d+)$/);
    if (dice) {
      const count = dice[1] === "" ? 1 : Number(dice[1]);
      const sides = Number(dice[2]);
      if (!Number.isInteger(count) || count < 1 || count > 100 || sides < 2 || sides > 1000) {
        throw new InvalidDiceExpressionError(expression);
      }
      return { sign, count, sides };
    }
    if (!/^\d+$/.test(body)) throw new InvalidDiceExpressionError(expression);
    return { sign, count: Number(body), sides: null };
  });
}

export function normalizeDiceExpression(expression: string): string {
  const terms = parseDiceExpression(expression);
  return terms.map((term, index) => {
    const sign = term.sign < 0 ? "-" : index > 0 ? "+" : "";
    return `${sign}${term.sides === null ? term.count : `${term.count}d${term.sides}`}`;
  }).join("");
}
