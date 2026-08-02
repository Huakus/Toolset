import type { CharacterV2 } from "../../domain/character/character-v2";
import type { TaleSpireApiSubset } from "./talespire-campaign-blob-store";

type MiniatureLink = NonNullable<CharacterV2["taleSpire"]>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

export class TaleSpireMiniatureAdapter {
  private packs: unknown | undefined;

  constructor(private readonly api: Pick<TaleSpireApiSubset, "creatures" | "contentPacks">) {}

  async selectFirst(): Promise<MiniatureLink> {
    if (!this.api.creatures) throw new Error("TaleSpire creature selection is unavailable");
    const selected = await this.api.creatures.getSelectedCreatures();
    if (!Array.isArray(selected) || typeof selected[0] !== "string") {
      throw new Error("Seleccioná una miniatura en TaleSpire antes de vincularla.");
    }
    const infoResult = await this.api.creatures.getMoreInfo([selected[0]]);
    if (!Array.isArray(infoResult) || infoResult.length === 0) {
      throw new Error("TaleSpire no devolvió información de la miniatura seleccionada.");
    }
    const info = object(infoResult[0]);
    const morphs = Array.isArray(info.morphs) ? info.morphs.map(object) : [];
    const activeMorph = morphs[Number(info.activeMorphIndex ?? 0)] ?? {};
    return {
      creatureId: String(info.id ?? selected[0]),
      displayName: String(info.name ?? info.creatureName ?? "Miniatura vinculada"),
      boardAssetId: String(activeMorph.boardAssetId ?? ""),
    };
  }

  async createThumbnail(link: MiniatureLink): Promise<HTMLElement | null> {
    if (!this.api.contentPacks || !link.boardAssetId) return null;
    if (this.packs === undefined) {
      const fragments = await this.api.contentPacks.getContentPacks();
      this.packs = await this.api.contentPacks.getMoreInfo(fragments);
    }
    const found = object(await this.api.contentPacks.findBoardObjectInPacks(link.boardAssetId, this.packs));
    const thumbnail = await this.api.contentPacks.createThumbnailElementForBoardObject(found.boardObject, 128);
    return thumbnail instanceof HTMLElement ? thumbnail : null;
  }
}
