import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema } from "../../shared/json";

export const LegacyCharacterV1Schema = JsonObjectSchema;

export const LegacyCampaignV1Schema = z
  .object({
    characters: z.record(z.string(), LegacyCharacterV1Schema),
    DmNotes: JsonValueSchema.optional(),
    "Encounter Data": JsonValueSchema.optional(),
  })
  .catchall(JsonValueSchema);

export type LegacyCharacterV1 = z.infer<typeof LegacyCharacterV1Schema>;
export type LegacyCampaignV1 = z.infer<typeof LegacyCampaignV1Schema>;
