# Player sheet: checks, saves and passive scores

The v2 character stores only authored check configuration:

- skill proficiency rank: none, half, proficient or expertise;
- saving-throw proficiency;
- explicit additive bonuses;
- normal, advantage or disadvantage roll mode;
- explicit passive-score bonuses;
- explicit initiative bonus and roll mode.

Ability modifiers, proficiency bonus, final skill/save modifiers, passive
Perception/Investigation/Insight and initiative are deterministic projections.

During v1 migration, each persisted skill modifier is compared with the normal
ability-plus-proficiency calculation. Any difference is retained as an
explicit bonus. This preserves customized legacy totals without treating a
derived number as a second source of truth.
