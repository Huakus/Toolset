import { z } from "zod";

export const ActivatableEffectSchema = z.object({
  description: z.string().default(""),
  active: z.boolean().default(false),
}).default({ description: "", active: false });

export type ActivatableEffect = z.infer<typeof ActivatableEffectSchema>;

