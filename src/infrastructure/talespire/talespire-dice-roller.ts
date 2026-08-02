import type {
  DiceRollRequest,
  DiceRollResult,
  DiceRoller,
} from "../../application/ports/dice-roller";
import { normalizeDiceExpression } from "../../domain/dice/dice-expression";

export interface TaleSpireDiceApi {
  putDiceInTray(
    rolls: { name: string; roll: string }[],
    clearBeforeAdding: boolean,
  ): Promise<unknown>;
  evaluateDiceResultsGroup?(group: unknown): Promise<number>;
  sendDiceResult?(groups: unknown[], rollId: string): Promise<unknown>;
}

export interface TaleSpireResolvedRoll {
  name: string;
  total: number;
}

export class TaleSpireDiceRoller implements DiceRoller {
  private readonly pending = new Map<string, DiceRollRequest>();
  private readonly listeners = new Set<(result: TaleSpireResolvedRoll) => void>();

  constructor(private readonly api: TaleSpireDiceApi) {}

  subscribe(listener: (result: TaleSpireResolvedRoll) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async roll(request: DiceRollRequest): Promise<DiceRollResult> {
    const suffix = request.mode === "advantage"
      ? " (Ventaja)"
      : request.mode === "disadvantage"
        ? " (Desventaja)"
        : "";
    const rolls = request.expressions.flatMap((expression, index) => {
      const roll = {
        name: `${request.name}${request.expressions.length > 1 ? ` ${index + 1}` : ""}${suffix}`,
        roll: normalizeDiceExpression(expression),
      };
      return request.mode === "normal" || !expression.toLowerCase().includes("d20")
        ? [roll]
        : [roll, { ...roll }];
    });
    const submitted = await this.api.putDiceInTray(rolls, true);
    const rollId = typeof submitted === "string"
      ? submitted
      : submitted !== null && typeof submitted === "object" && typeof Reflect.get(submitted, "rollId") === "string"
        ? String(Reflect.get(submitted, "rollId"))
        : null;
    if (rollId) this.pending.set(rollId, request);
    return {
      kind: "submitted",
      summary: `${request.name} enviado a la bandeja de TaleSpire.`,
      totals: [],
    };
  }

  async handleRollEvent(event: unknown): Promise<void> {
    if (event === null || typeof event !== "object" || Reflect.get(event, "kind") !== "rollResults") return;
    const payload = Reflect.get(event, "payload");
    if (payload === null || typeof payload !== "object") return;
    const rollId = Reflect.get(payload, "rollId");
    const groups = Reflect.get(payload, "resultsGroups");
    if (typeof rollId !== "string" || !Array.isArray(groups)) return;
    const request = this.pending.get(rollId);
    if (!request) return;
    this.pending.delete(rollId);
    const totals = await Promise.all(groups.map((group) => this.evaluateGroup(group)));
    const total = request.mode === "advantage"
      ? Math.max(...totals)
      : request.mode === "disadvantage"
        ? Math.min(...totals)
        : totals[0];
    if (total !== undefined && Number.isFinite(total)) {
      const resolved = { name: request.name, total };
      this.listeners.forEach((listener) => listener(resolved));
    }
    await this.api.sendDiceResult?.(groups, rollId);
  }

  private async evaluateGroup(group: unknown): Promise<number> {
    if (this.api.evaluateDiceResultsGroup) return this.api.evaluateDiceResultsGroup(group);
    if (group === null || typeof group !== "object") return 0;
    return this.evaluateResult(Reflect.get(group, "result"));
  }

  private evaluateResult(result: unknown): number {
    if (result === null || typeof result !== "object") return 0;
    const value = Reflect.get(result, "value");
    if (typeof value === "number") return value;
    const rolled = Reflect.get(result, "results");
    if (Array.isArray(rolled)) return rolled.reduce<number>((sum, entry) => sum + (Number(entry) || 0), 0);
    const operands = Reflect.get(result, "operands");
    if (!Array.isArray(operands)) return 0;
    const values = operands.map((operand) => this.evaluateResult(operand));
    return Reflect.get(result, "operator") === "-"
      ? (values[0] ?? 0) - values.slice(1).reduce((sum, entry) => sum + entry, 0)
      : values.reduce((sum, entry) => sum + entry, 0);
  }
}
