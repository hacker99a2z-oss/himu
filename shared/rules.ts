// Shared game rules (client + server). Money is stored in whole cents.
export type CropKey = "wheat" | "corn" | "carrot" | "tomato" | "pumpkin";
export const CROP_KEYS: CropKey[] = ["wheat", "corn", "carrot", "tomato", "pumpkin"];

/** adsNeed: ads that fully grow one plant. seedPrice10: price in cents for 10 seeds. */
export const CROP_RULES: Record<CropKey, { adsNeed: number; sellCents: number; seedPrice10: number }> = {
  wheat: { adsNeed: 10, sellCents: 1, seedPrice10: 1 },
  corn: { adsNeed: 20, sellCents: 2, seedPrice10: 2 },
  carrot: { adsNeed: 28, sellCents: 3, seedPrice10: 2.8 },
  tomato: { adsNeed: 36, sellCents: 4, seedPrice10: 3.6 },
  pumpkin: { adsNeed: 45, sellCents: 5, seedPrice10: 4.5 },
};

export const MIN_WITHDRAW_CENTS = 3;
export const REFERRAL_PERCENT = 20;
export const MIN_SEED_BUY = 10;
export const MAX_SEED_BUY = 1_000_000;
export const AD_COOLDOWN_MS = 3 * 60 * 1000;
export const GROW_MS: Record<CropKey, number> = {
  wheat: 72 * 60 * 60 * 1000,
  corn: 120 * 60 * 60 * 1000,
  carrot: 168 * 60 * 60 * 1000,
  tomato: 216 * 60 * 60 * 1000,
  pumpkin: 264 * 60 * 60 * 1000,
};
export const GROW_STAGES = 10;

/** Weekly daily-reward row: day 1..7 -> seed given (1 each). */
export const DAILY_REWARDS: CropKey[] = ["wheat", "wheat", "corn", "corn", "carrot", "tomato", "pumpkin"];
export const DAILY_SEEDS = 1;

export const seedPriceCents = (k: CropKey, qty: number) => (qty * CROP_RULES[k].seedPrice10) / 10;
export const sellValueCents = (k: CropKey, qty: number) => CROP_RULES[k].sellCents * qty;
export const referralRewardCents = (paidCents: number) => Math.floor((paidCents * REFERRAL_PERCENT) / 100);
export const tonNanoForUsd = (cents: number, tonUsd: number) => BigInt(Math.ceil(((cents / 100) / tonUsd) * 1e9));

/** Wheat and corn are free; the rest unlock once (price in cents) and then have unlimited seeds. */
export const UNLOCK_CENTS: Partial<Record<CropKey, number>> = { carrot: 30, tomato: 40, pumpkin: 50 };
export const isLockable = (k: CropKey) => UNLOCK_CENTS[k] !== undefined;
export const isUnlocked = (k: CropKey, unlocked?: Partial<Record<CropKey, boolean>>) => !isLockable(k) || !!unlocked?.[k];

/** Giveaway: entry costs 1 harvested corn; every verified ad adds +1 point. */
export const GIVEAWAY_ENTRY_CROP = "corn" as const;
/** Total points (all entrants together) needed before the round is distributed. */
export const GIVEAWAY_GOAL_POINTS = 2000;
/** Fixed amount shared by every entrant of a round, by rank. */
export const GIVEAWAY_DISTRIBUTION_CENTS = 500;
export const CONTEST_SHOWN = 100;
/**
 * Split the whole amount between ALL entrants, higher rank gets more (linear weights n..1).
 * Works in hundredths of a cent ($0.0001) without losing rounding remainders.
 */
export function contestPrizesCents(poolCents: number, entrants: number): number[] {
  const count = Math.max(0, Math.floor(entrants));
  if (!count || poolCents <= 0) return [];
  const weights = Array.from({ length: count }, (_, i) => count - i);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const units = Math.round(poolCents * 100);
  const shares = weights.map((weight, rank) => {
    const numerator = units * weight;
    return { rank, units: Math.floor(numerator / totalWeight), remainder: numerator % totalWeight };
  });
  const remaining = units - shares.reduce((sum, share) => sum + share.units, 0);
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || a.rank - b.rank);
  for (const share of order.slice(0, remaining)) share.units += 1;
  return shares.map((share) => share.units / 100);
}
/** Prize in cents for rank (1-based) among all entrants. */
export const contestPrizeCents = (rank: number, poolCents: number, entrants: number): number =>
  Number.isInteger(rank) && rank > 0 ? (contestPrizesCents(poolCents, entrants)[rank - 1] ?? 0) : 0;
const WEEK_MS = 7 * 86_400_000;
/** Contest weeks start Monday 00:00 UTC. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86_400_000;
}
export const weekEnd = (t: number) => weekStart(t) + WEEK_MS;
export const weekKey = (t: number) => dayKey(weekStart(t));
export type ContestView = {
  round: number;
  serverNow: number;
  goalPoints: number;
  totalPoints: number;
  distributionCents: number;
  entered: boolean;
  entrants: number;
  rows: { rank: number; name: string; points: number; prizeCents: number; me: boolean }[];
};

export type Field = { planted: boolean; plantedAt: number; ads: number };
export const FIELD_PART_COUNTS: Record<CropKey, number> = { wheat: 2, corn: 2, carrot: 2, tomato: 2, pumpkin: 4 };
export const WITHDRAWAL_HISTORY_LIMIT = 5;
const EMPTY: Field = { planted: false, plantedAt: 0, ads: 0 };

type Saved = { planted?: boolean; plantedAt?: number; ads?: number; watered?: boolean };
export function fieldParts(k: CropKey, saved?: Saved | Saved[]): Field[] {
  const parts = Array.isArray(saved) ? saved : saved ? [saved] : [];
  return Array.from({ length: FIELD_PART_COUNTS[k] }, (_, i) => {
    const p = parts[i];
    if (!p?.planted) return { ...EMPTY };
    // Legacy plants (from the water version) have no plantedAt: treat them as fully grown.
    return { planted: true, plantedAt: typeof p.plantedAt === "number" ? p.plantedAt : 0, ads: p.ads ?? 0 };
  });
}
export function isFieldPart(k: CropKey, part: unknown): part is number {
  return typeof part === "number" && Number.isInteger(part) && part >= 0 && part < FIELD_PART_COUNTS[k];
}
export function latestWithdrawals<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, WITHDRAWAL_HISTORY_LIMIT);
}

/** Growth 0..1: waiting time and watched ads both add progress. */
export function growth(k: CropKey, f: Field, now: number): number {
  if (!f.planted) return 0;
  return Math.min(1, Math.max(0, (now - f.plantedAt) / GROW_MS[k]) + f.ads / CROP_RULES[k].adsNeed);
}
export const growStage = (k: CropKey, f: Field, now: number) => Math.floor(growth(k, f, now) * GROW_STAGES + 1e-9);
export const isReady = (k: CropKey, f: Field, now: number) => f.planted && growth(k, f, now) >= 1;
export const msLeft = (k: CropKey, f: Field, now: number) => {
  if (!f.planted) return 0;
  return Math.max(0, Math.ceil(GROW_MS[k] - Math.max(0, now - f.plantedAt) - f.ads * (GROW_MS[k] / CROP_RULES[k].adsNeed)));
};

/** UTC day key "YYYY-MM-DD". */
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
export type Daily = { streak: number; lastDay: string | null };
/** Days already ticked in the current week (0..7) and whether today's claim is open. */
export function dailyStatus(d: Daily | undefined, now: number): { done: number; canClaim: boolean } {
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  if (!d?.lastDay) return { done: 0, canClaim: true };
  if (d.lastDay === today) return { done: d.streak, canClaim: false };
  if (d.lastDay === yesterday && d.streak < 7) return { done: d.streak, canClaim: true };
  return { done: 0, canClaim: true }; // missed a day or finished the week -> restart
}

export type PlayerView = {
  balanceCents: number;
  seeds: Record<CropKey, number>;
  unlocked: Record<CropKey, boolean>;
  crops: Record<CropKey, number>;
  fields: Record<CropKey, Field[]>;
  daily: { done: number; canClaim: boolean };
  referralCount: number;
  referralEarnedCents: number;
  nextAdAt: number | null;
  serverNow: number;
  withdrawals: { id: string; cents: number; address: string; status: string; date: string }[];
};
