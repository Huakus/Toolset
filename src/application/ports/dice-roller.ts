import type { z } from "zod";
import { RollModeSchema } from "../../domain/character/character-checks";

export interface DiceRollRequest {
  name: string;
  expressions: string[];
  mode: z.infer<typeof RollModeSchema>;
}

export interface DiceRollResult {
  kind: "rolled" | "submitted";
  summary: string;
  totals: number[];
}

export interface DiceRoller {
  roll(request: DiceRollRequest): Promise<DiceRollResult>;
}
