# Player sheet: actions, attacks and dice

Legacy positional action columns are migrated into a typed action model with a
stable ID, categories, activation, reach, ability, proficiency, explicit attack
bonus, damage expression, damage bonus/type, weapon properties, description and
optional inventory link.

Final attack modifiers are derived from ability, character proficiency and the
explicit action bonus. Legacy displayed totals are preserved by converting any
difference into that explicit bonus.

The dice boundary supports normal, advantage and disadvantage modes, additive
dice expressions and slash-separated damage groups. In a regular browser it
uses a local cryptographic random source. With TaleSpire's injected dice API it
submits descriptors to the in-game tray. Bless/Guidance and Bane conditions add
their d4 modifier to d20 expressions.
