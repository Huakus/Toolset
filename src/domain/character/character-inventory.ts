import {
  CharacterV2Schema,
  IsoTimestampSchema,
  StableIdSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterRevisionConflictError } from "./edit-character";
import {
  CharacterInventoryItemV2Schema,
  type CharacterInventoryItemV2,
} from "./character-inventory-model";

export * from "./character-inventory-model";

export class InventoryItemNotFoundError extends Error {
  constructor(readonly itemId: string) {
    super(`Inventory item ${itemId} was not found`);
    this.name = "InventoryItemNotFoundError";
  }
}

export class AttunementLimitError extends Error {
  constructor(readonly maximum: number) {
    super(`A character cannot be attuned to more than ${maximum} items`);
    this.name = "AttunementLimitError";
  }
}

export class InventoryUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryUseError";
  }
}

export class InventoryEquipmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryEquipmentError";
  }
}

interface InventoryMutationOptions {
  expectedRevision: number;
  updatedAt: string;
  splitItemId?: string;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function itemClassification(item: CharacterInventoryItemV2): string {
  return normalized([
    item.category,
    item.name,
    item.armor?.armorCategory ?? "",
    ...item.properties,
  ].join(" "));
}

export function inventoryEquipmentSlot(item: CharacterInventoryItemV2): string | null {
  const value = itemClassification(item);
  if (item.weapon) return null;
  if (value.includes("shield") || value.includes("escudo")) return "shield";
  if (/(boot|bota|shoe|zapato|slipper|calzado)/.test(value)) return "feet";
  if (/(cloak|cape|capa|manto|back slot)/.test(value)) return "back";
  if (/(helmet|helm|casco|hat|sombrero|headband|diadema)/.test(value)) return "head";
  if (/(glove|guante|gauntlet|guantelete|bracer|brazal)/.test(value)) return "hands-worn";
  if (/(belt|cinturon|cinturón)/.test(value)) return "waist";
  if (/(amulet|amuleto|necklace|collar)/.test(value)) return "neck";
  if (item.armor || /(armor|armadura|tunic|tunica|túnica|robe|vestimenta)/.test(value)) return "body";
  return null;
}

export function inventoryItemHandCost(item: CharacterInventoryItemV2): number {
  const value = itemClassification(item);
  if (value.includes("shield") || value.includes("escudo")) return 1;
  if (!item.weapon) return 0;
  return item.properties.some((property) => {
    const normalizedProperty = normalized(property);
    return normalizedProperty.includes("two-handed") || normalizedProperty.includes("two handed") || normalizedProperty.includes("dos manos");
  }) ? 2 : 1;
}

export function inventoryItemsCanStack(
  left: CharacterInventoryItemV2,
  right: CharacterInventoryItemV2,
): boolean {
  if (left.equipped || right.equipped || left.attuned || right.attuned) return false;
  const comparable = (item: CharacterInventoryItemV2) => {
    const { id: _id, order: _order, quantity: _quantity, equipped: _equipped, attuned: _attuned, ...rest } = item;
    return rest;
  };
  return normalized(left.name) === normalized(right.name) &&
    JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function prepare(
  input: CharacterV2,
  options: InventoryMutationOptions,
): { character: CharacterV2; updatedAt: string } {
  const character = CharacterV2Schema.parse(input);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(
      options.expectedRevision,
      character.revision,
    );
  }
  return { character, updatedAt };
}

function finish(
  character: CharacterV2,
  inventory: CharacterV2["inventory"],
  updatedAt: string,
  actions = character.actions,
): CharacterV2 {
  return CharacterV2Schema.parse({
    ...character,
    inventory: [...inventory].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    ),
    actions,
    revision: character.revision + 1,
    metadata: { ...character.metadata, updatedAt },
  });
}

export function upsertInventoryItem(
  input: CharacterV2,
  itemInput: CharacterInventoryItemV2,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const item = CharacterInventoryItemV2Schema.parse(itemInput);
  if (item.equipped && item.quantity !== 1) {
    throw new InventoryEquipmentError("Los objetos equipados deben tener cantidad 1");
  }
  const inventory = [
    ...character.inventory.filter((existing) => existing.id !== item.id),
    item,
  ];
  if (item.attuned && inventory.filter((entry) => entry.attuned).length > 3) {
    throw new AttunementLimitError(3);
  }
  return finish(character, inventory, updatedAt);
}

export function removeInventoryItem(
  input: CharacterV2,
  itemIdInput: string,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const itemId = StableIdSchema.parse(itemIdInput);
  if (!character.inventory.some((item) => item.id === itemId)) {
    throw new InventoryItemNotFoundError(itemId);
  }
  return finish(
    character,
    character.inventory.filter((item) => item.id !== itemId),
    updatedAt,
    character.actions.filter((action) => action.inventoryItemId !== itemId),
  );
}

export function setInventoryItemEquipped(
  input: CharacterV2,
  itemIdInput: string,
  equipped: boolean,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const itemId = StableIdSchema.parse(itemIdInput);
  const target = character.inventory.find((item) => item.id === itemId);
  if (!target) throw new InventoryItemNotFoundError(itemId);
  if (equipped && target.quantity < 1) {
    throw new InventoryEquipmentError("No se puede equipar un objeto sin unidades disponibles");
  }

  const targetSlot = inventoryEquipmentSlot(target);
  const targetHandCost = inventoryItemHandCost(target);
  const occupiedHands = character.inventory
    .filter((item) => item.equipped && item.id !== itemId)
    .reduce((total, item) => total + inventoryItemHandCost(item), 0);
  if (equipped && targetHandCost > 0 && occupiedHands + targetHandCost > 2) {
    throw new InventoryEquipmentError("No hay manos libres suficientes para equipar este objeto");
  }

  const splitItemId = options.splitItemId === undefined ? null : StableIdSchema.parse(options.splitItemId);
  if (equipped && target.quantity > 1 && splitItemId === null) {
    throw new InventoryEquipmentError("Se necesita un identificador para separar el stack equipado");
  }

  const inventory = character.inventory.flatMap((item) => {
    if (item.id === itemId) {
      const equippedItem = {
        ...item,
        quantity: equipped ? 1 : item.quantity,
        equipped,
        attuned: equipped ? item.attuned : false,
      };
      return equipped && item.quantity > 1
        ? [equippedItem, {
            ...item,
            id: splitItemId!,
            order: item.order + 1,
            quantity: item.quantity - 1,
            equipped: false,
            attuned: false,
          }]
        : [equippedItem];
    }
    if (equipped && targetSlot !== null && inventoryEquipmentSlot(item) === targetSlot) {
      return [{ ...item, equipped: false, attuned: false }];
    }
    return [item];
  });
  const actions = equipped
    ? character.actions
    : character.actions.filter((action) => action.inventoryItemId !== itemId);
  return finish(character, inventory, updatedAt, actions);
}

export function setInventoryItemAttuned(
  input: CharacterV2,
  itemIdInput: string,
  attuned: boolean,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const itemId = StableIdSchema.parse(itemIdInput);
  const target = character.inventory.find((item) => item.id === itemId);
  if (!target) throw new InventoryItemNotFoundError(itemId);
  if (attuned && (!target.requiresAttunement || !target.equipped)) {
    throw new InventoryUseError("The item must require attunement and be equipped first");
  }
  if (attuned && character.inventory.filter((item) => item.attuned).length >= 3) {
    throw new AttunementLimitError(3);
  }
  return finish(
    character,
    character.inventory.map((item) =>
      item.id === itemId ? { ...item, attuned } : item,
    ),
    updatedAt,
  );
}

export function useInventoryItem(
  input: CharacterV2,
  itemIdInput: string,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const itemId = StableIdSchema.parse(itemIdInput);
  const target = character.inventory.find((item) => item.id === itemId);
  if (!target) throw new InventoryItemNotFoundError(itemId);
  if (!target.usable) throw new InventoryUseError(`${target.name} is not usable`);
  if (!target.equipped && !target.consumable) {
    throw new InventoryUseError(`${target.name} debe estar equipado para poder usarse`);
  }

  let remove = false;
  const inventory = character.inventory.map((item) => {
    if (item.id !== itemId) return item;
    if (item.charges !== null) {
      if (item.charges.current < 1) {
        throw new InventoryUseError(`${item.name} has no charges remaining`);
      }
      return {
        ...item,
        charges: { ...item.charges, current: item.charges.current - 1 },
      };
    }
    if (!item.consumable) return item;
    if (item.quantity < 1) {
      throw new InventoryUseError(`${item.name} has no quantity remaining`);
    }
    remove = item.quantity === 1;
    return { ...item, quantity: item.quantity - 1 };
  });
  return finish(
    character,
    remove ? inventory.filter((item) => item.id !== itemId) : inventory,
    updatedAt,
    remove
      ? character.actions.filter((action) => action.inventoryItemId !== itemId)
      : character.actions,
  );
}

export function resetInventoryCharges(
  input: CharacterV2,
  reset: string,
  options: InventoryMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  return finish(
    character,
    character.inventory.map((item) =>
      item.charges !== null && item.charges.reset === reset
        ? { ...item, charges: { ...item.charges, current: item.charges.maximum } }
        : item,
    ),
    updatedAt,
  );
}
