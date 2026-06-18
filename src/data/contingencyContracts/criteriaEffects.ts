import type { Effect, TriggerEffect } from '../types';

/**
 * Damage-model mechanism for a Contingency Contract criterion, ported from the optimizer's
 * hand-authored `contingency-contract/criteria.ts`. Keyed by Endaxis `groupId` (numeric), which
 * corresponds to the optimizer's `group: 'c<groupId>'`.
 *
 * `effects` are operator-side passive modifiers (`target: 'team'`); `triggers` express enemy-side
 * and reactive behaviour. Leveled values (e.g. `[-45, -90]`) are resolved at `level - 1` by
 * `resolveEffect` / `resolveTriggerEffectLevel`. `levelCount` bounds the selectable level index.
 *
 * Only criteria whose behaviour is modeled in the damage engine are listed here.
 */
export interface CriterionMechanism {
  /** Number of selectable levels (for value-array indexing / clamping). */
  levelCount: number;
  effects?: Effect[];
  triggers?: TriggerEffect[];
}

/** The five infliction/vulnerability (status, element) pairs the enemy can carry. */
const INFLICTION_PAIRS = [
  ['vulnerability', 'physical'],
  ['heatInfliction', 'heat'],
  ['cryoInfliction', 'cryo'],
  ['electricInfliction', 'electric'],
  ['natureInfliction', 'nature'],
] as const;

export const CRITERION_MECHANISMS: Record<number, CriterionMechanism> = {
  // ── Weaken (队列：萎缩) — operator main attribute ×0.9 / ×0.8 / ×0.6 ──────────
  1028: {
    levelCount: 3,
    effects: [
      {
        kind: 'status',
        stat: { modifier: 'attributePercent', attribute: 'main' },
        target: 'team',
        value: [-10, -20, -40],
        external: true,
      },
    ],
  },

  // ── Strangle (队列：扼制) — after raising an enemy's vuln/infliction, that operator's
  //    matching-type DMG -45% / -90% for 10s. ─────────────────────────────────────
  1009: {
    levelCount: 2,
    triggers: INFLICTION_PAIRS.map(
      ([status, element]): TriggerEffect => ({
        trigger: { kind: 'onStatusApplied', status, target: 'enemy', triggerScope: 'global' },
        effects: [
          {
            kind: 'status',
            stat: { modifier: 'dmgBonus', elements: [element] },
            target: 'self',
            value: [-45, -90],
            duration: 10,
            external: true,
          },
        ],
      }),
    ),
  },

  // ── Bent Edges (队列：折刃) — each ultimate cast: subsequent ultimate DMG -50% / -100%. ──
  1005: {
    levelCount: 2,
    triggers: [
      {
        trigger: { kind: 'onActionStart', skillTypes: 'ultimate', triggerScope: 'global' },
        effects: [
          {
            kind: 'status',
            id: 'bent-edges',
            stat: { modifier: 'dmgBonus', skillTypes: 'ultimate' },
            target: 'self',
            value: 0,
            scaling: {
              additive: [{ key: 'bent-edges-count', target: 'self', coefficient: [-50, -100] }],
            },
            external: true,
            stackStrategy: 'REPLACE',
            duration: Infinity,
            hide: true,
          },
          {
            kind: 'status',
            id: 'bent-edges-count',
            target: 'self',
            stacks: 1,
            maxStacks: 99,
            stackStrategy: 'REFRESH_DURATION',
            duration: Infinity,
            hide: true,
          },
        ],
      },
    ],
  },

  // ── Poor Basics (队列：脱力) — Basic Attack DMG -70%. ─────────────────────────────
  1008: {
    levelCount: 1,
    effects: [
      {
        kind: 'status',
        stat: { modifier: 'dmgBonus', skillTypes: 'basicAttack' },
        target: 'team',
        value: -70,
      },
    ],
  },

  // ── Effect Barrier (改写：屏障) — each enemy can only receive vuln or a same-type Arts
  //    Infliction once every 5s. ───────────────────────────────────────────────────
  1010: {
    levelCount: 1,
    triggers: INFLICTION_PAIRS.map(
      ([listen, element]): TriggerEffect => ({
        trigger: {
          kind: 'onStatusApplied',
          status: listen,
          target: 'enemy',
          triggerScope: 'global',
        },
        effects: [
          {
            kind: 'status',
            id: `inflictionBarrier-${element}`,
            stat: { modifier: 'inflictionBarrier', elements: element },
            target: 'enemy',
            duration: 5,
            silent: true,
            hide: true,
          },
        ],
      }),
    ),
  },

  // ── Overclock (环境：过速) — Combo Skill cooldown ×0.4 (-60%); Battle Skill DMG -60%. ──
  1000: {
    levelCount: 1,
    effects: [
      {
        kind: 'status',
        stat: { modifier: 'cooldownReductionPercent', skillTypes: 'comboSkill' },
        target: 'team',
        value: 60,
        external: true,
      },
      {
        kind: 'status',
        stat: { modifier: 'dmgBonus', skillTypes: 'battleSkill' },
        target: 'team',
        value: -60,
      },
    ],
  },

  // ── Tremor (环境：震荡) — Battle Skill DMG -60%; non-skill-typed DMG +100%. ─────────
  1032: {
    levelCount: 1,
    effects: [
      {
        kind: 'status',
        stat: { modifier: 'dmgBonus', skillTypes: 'battleSkill' },
        target: 'team',
        value: -60,
      },
      {
        kind: 'status',
        stat: { modifier: 'dmgBonus', skillTypes: 'nonSkill' },
        target: 'team',
        value: 100,
        external: true,
      },
    ],
  },

  // ── Wrap (改写：裹附) — per vuln/Arts-Infliction stack on an enemy, that enemy takes
  //    -10% matching-type DMG; ends with the stack. ─────────────────────────────────
  1031: {
    levelCount: 1,
    triggers: INFLICTION_PAIRS.flatMap(([key, element]): TriggerEffect[] => {
      const base = {
        kind: 'status' as const,
        id: `wrap-${element}`,
        stat: { modifier: 'increasedDmgTaken' as const, elements: element },
        target: 'enemy' as const,
        external: true,
        stacks: 1,
        maxStacks: 1,
        duration: Infinity,
        hide: true,
        silent: true,
      };
      return [
        {
          trigger: { kind: 'onStatusApplied', status: key, target: 'enemy', triggerScope: 'global' },
          effects: [
            {
              ...base,
              value: 0,
              scaling: { additive: [{ key, target: 'enemy', coefficient: -10 }] },
            },
          ],
        },
        {
          trigger: { kind: 'onStatusExpire', status: key, target: 'enemy', triggerScope: 'global' },
          effects: [{ ...base, value: 0 }],
        },
        {
          trigger: { kind: 'onStatusConsumed', status: key, target: 'enemy', triggerScope: 'global' },
          effects: [{ ...base, value: 0 }],
        },
      ];
    }),
  },
};

/** True when the given numeric groupId has a damage-model mechanism implemented. */
export function hasCriterionMechanism(groupId: number): boolean {
  return groupId in CRITERION_MECHANISMS;
}
