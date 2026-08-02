import { z } from "zod";

export const GmShopSchema = z.object({
  name: z.string().min(1),
  categories: z.record(z.string(), z.array(z.string().min(1))),
});

export const GmChecklistItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  checked: z.boolean(),
});

export type GmShop = z.infer<typeof GmShopSchema>;
export type GmChecklistItem = z.infer<typeof GmChecklistItemSchema>;

export function normalizeShop(name: string, input: unknown): GmShop {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const categories: Record<string, string[]> = {};
  for (const [category, value] of Object.entries(source)) {
    const entries = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
    categories[category] = entries.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return GmShopSchema.parse({ name, categories });
}

export function normalizeChecklistItem(id: string, input: unknown): GmChecklistItem {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return GmChecklistItemSchema.parse({
    id,
    text: String(source.text ?? source.itemText ?? source.value ?? "").trim(),
    checked: Boolean(source.checked ?? source.completed),
  });
}
