import type {
  DiceRollRequest,
  DiceRollResult,
  DiceRoller,
} from "../../application/ports/dice-roller";
import { parseDiceExpression } from "../../domain/dice/dice-expression";

function randomDie(sides: number): number {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return (value[0]! % sides) + 1;
}

function evaluate(expression: string): number {
  return parseDiceExpression(expression).reduce((total, term) => {
    if (term.sides === null) return total + term.sign * term.count;
    let rolled = 0;
    for (let index = 0; index < term.count; index += 1) rolled += randomDie(term.sides);
    return total + term.sign * rolled;
  }, 0);
}

export class BrowserDiceRoller implements DiceRoller {
  async roll(request: DiceRollRequest): Promise<DiceRollResult> {
    const totals = request.expressions.map((expression) => {
      if (request.mode === "normal" || !expression.toLowerCase().includes("d20")) {
        return evaluate(expression);
      }
      const first = evaluate(expression);
      const second = evaluate(expression);
      return request.mode === "advantage"
        ? Math.max(first, second)
        : Math.min(first, second);
    });
    return {
      kind: "rolled",
      summary: `${request.name}: ${totals.join(" / ")}`,
      totals,
    };
  }
}
