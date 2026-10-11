// Shared game rules (client + server). Money is stored in whole cents.
export type CropKey = "wheat" | "corn" | "carrot" | "tomato" | "pumpkin";
export const CROP_KEYS: CropKey[] = ["wheat", "corn", "carrot", "tomato", "pumpkin"];

export const CROP_RULES: Record<CropKey, { waterNeed: number; sellCents: number }> = {
  wheat: { waterNeed: 100, sellCents: 1 },
  corn: { waterNeed: 200, sellCents: 2 },
  carrot: { waterNeed: 280, sellCents: 3 },
  tomato: { waterNeed: 360, sellCents: 4 },
  pumpkin: { waterNeed: 450, sellCents: 5 },
};

export const MIN_WITHDRAW_CENTS = 10;
export const WATER_PER_PACK = 1000;
export const PACK_PRICE_CENTS = 10;
export const REFERRAL_PERCENT = 10;
export const START_WATER = 100;
export const MIN_WATER_BUY = 100;
export const MAX_WATER_BUY = 1_000_000;
export const AD_REWARD_WATER = 10;
export const AD_COOLDOWN_MS = 3 * 60 * 1000;
/** Price in (possibly fractional) cents for an amount of water: 1000 water = $1. */
export const waterPriceCents = (water: number) => (water * PACK_PRICE_CENTS) / WATER_PER_PACK;

export const sellValueCents = (k: CropKey, qty: number) => CROP_RULES[k].sellCents * qty;
export const referralRewardCents = (paidCents: number) => Math.floor((paidCents * REFERRAL_PERCENT) / 100);
export const tonNanoForUsd = (cents: number, tonUsd: number) => BigInt(Math.ceil(((cents / 100) / tonUsd) * 1e9));

export type Field = { planted: boolean; watered: boolean };
export type PlayerView = {
  balanceCents: number;
  water: number;
  crops: Record<CropKey, number>;
  fields: Record<CropKey, Field>;
  referralCount: number;
  referralEarnedCents: number;
  nextAdAt: number | null;
  withdrawals: { id: string; cents: number; address: string; status: string; date: string }[];
};

/** Next step when a field is tapped. */
export function nextFieldAction(f: Field): "plant" | "water" | "harvest" {
  if (!f.planted) return "plant";
  return f.watered ? "harvest" : "water";
}
