export type TaleSpireClientRole = "gm" | "player";

export interface TaleSpireRoleClientApi {
  whoAmI(): Promise<unknown>;
  getMoreInfo(clients: unknown[]): Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function mode(value: unknown): TaleSpireClientRole | null {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (normalized === "gm") return "gm";
  if (normalized === "player") return "player";
  return null;
}

export async function resolveTaleSpireClientRole(api: TaleSpireRoleClientApi): Promise<TaleSpireClientRole> {
  const identity = object(await api.whoAmI());
  const direct = mode(identity?.clientMode);
  if (direct) return direct;
  if (!identity) return "player";
  try {
    const details = await api.getMoreInfo([identity]);
    const detail = Array.isArray(details) ? object(details[0]) : object(details);
    return mode(detail?.clientMode) ?? "player";
  } catch {
    return "player";
  }
}
