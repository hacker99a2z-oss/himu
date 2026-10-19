import { describe, expect, it } from "vitest";
import { CROP_RULES, GROW_MS, dailyStatus, dayKey, fieldParts, growStage, isReady, msLeft, seedPriceCents, type CropKey } from "./rules.js";

describe("seeds, growth and daily reward", () => {
  it("ads needed per crop", () => {
    expect(Object.values(CROP_RULES).map((c) => c.adsNeed)).toEqual([10, 20, 28, 36, 45]);
  });
  it("10 seeds prices", () => {
    expect(seedPriceCents("wheat", 10)).toBe(1);
    expect(seedPriceCents("pumpkin", 10)).toBe(4.5);
    expect(seedPriceCents("carrot", 20)).toBeCloseTo(5.6);
  });
  it("grows in 10 steps by time or ads", () => {
    const f = { planted: true, plantedAt: 0, ads: 0 };
    expect(growStage("wheat", f, GROW_MS.wheat / 10)).toBe(1);
    expect(isReady("wheat", f, GROW_MS.wheat)).toBe(true);
    expect(growStage("wheat", { ...f, ads: 3 }, 0)).toBe(3);
    expect(isReady("corn", { ...f, ads: 20 }, 0)).toBe(true);
  });
  it("empty fields have 2 parts, pumpkin 4", () => {
    expect(fieldParts("wheat")).toHaveLength(2);
    expect(fieldParts("pumpkin")).toHaveLength(4);
  });
  it("daily streak resets after a missed day or a finished week", () => {
    const now = Date.parse("2026-10-13T10:00:00Z");
    const yest = dayKey(now - 86_400_000);
    expect(dailyStatus({ streak: 3, lastDay: yest }, now)).toEqual({ done: 3, canClaim: true });
    expect(dailyStatus({ streak: 3, lastDay: "2026-10-10" }, now)).toEqual({ done: 0, canClaim: true });
    expect(dailyStatus({ streak: 7, lastDay: yest }, now)).toEqual({ done: 0, canClaim: true });
    expect(dailyStatus({ streak: 2, lastDay: dayKey(now) }, now)).toEqual({ done: 2, canClaim: false });
  });
});

import { REFERRAL_PERCENT, UNLOCK_CENTS, contestPrizeCents, contestPrizesCents, isUnlocked, referralRewardCents, weekStart, CONTEST_ENTRY_CENTS, CONTEST_SHOWN } from "./rules.js";
describe("unlocks, referral and contest", () => {
  it("unlock prices: carrot $0.30, tomato $0.40, pumpkin $0.50; wheat/corn free", () => {
    expect(UNLOCK_CENTS).toEqual({ carrot: 30, tomato: 40, pumpkin: 50 });
    expect(isUnlocked("wheat")).toBe(true);
    expect(isUnlocked("corn")).toBe(true);
    expect(isUnlocked("carrot", {})).toBe(false);
    expect(isUnlocked("pumpkin", { pumpkin: true })).toBe(true);
  });
  it("referrer gets 20% of the unlock price", () => {
    expect(REFERRAL_PERCENT).toBe(20);
    expect(referralRewardCents(50)).toBe(10);
  });
  it("one entrant receives the entire $0.05 pool", () => {
    expect(CONTEST_ENTRY_CENTS).toBe(5);
    expect(contestPrizesCents(5, 1)).toEqual([5]);
    expect(contestPrizeCents(2, 5, 1)).toBe(0);
  });
  it.each([2, 3, 4, 10, 11, 30])("%i entrants share the entire pool in descending rank order, capped at 10", (entrants) => {
    const pool = entrants * 5;
    const prizes = contestPrizesCents(pool, entrants);
    expect(prizes).toHaveLength(Math.min(entrants, 10));
    expect(prizes.reduce((sum, prize) => sum + Math.round(prize * 100), 0)).toBe(pool * 100);
    prizes.slice(1).forEach((prize, index) => expect(prizes[index]).toBeGreaterThan(prize));
    expect(contestPrizeCents(11, pool, entrants)).toBe(0);
  });
  it("joining grows the pool and recalculates existing ranks", () => {
    expect(contestPrizeCents(1, 10, 2)).not.toBe(contestPrizeCents(1, 5, 1));
    expect(contestPrizeCents(2, 15, 3)).not.toBe(contestPrizeCents(2, 10, 2));
    expect(CONTEST_SHOWN).toBe(30);
  });
  it("no entrants means no prizes", () => {
    expect(contestPrizesCents(0, 0)).toEqual([]);
  });
  it("weeks start Monday UTC", () => {
    expect(new Date(weekStart(Date.parse("2026-10-18T17:00:00Z"))).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});

describe("crop-specific natural growth and per-ad reductions", () => {
  const cases: [CropKey, number, number][] = [
    ["wheat", 72, 10], ["corn", 120, 20], ["carrot", 168, 28],
    ["tomato", 216, 36], ["pumpkin", 264, 45],
  ];
  it.each(cases)("%s grows in %i hours and each of its %i ads removes an equal fraction", (crop, hours, ads) => {
    const duration = hours * 3_600_000;
    const start = Date.parse("2026-10-19T04:51:00Z");
    const field = { planted: true, plantedAt: start, ads: 0 };
    expect(GROW_MS[crop]).toBe(duration);
    expect(CROP_RULES[crop].adsNeed).toBe(ads);
    expect(msLeft(crop, field, start)).toBe(duration);
    expect(isReady(crop, field, start + duration - 1)).toBe(false);
    expect(isReady(crop, field, start + duration)).toBe(true);
    expect(msLeft(crop, { ...field, ads: 1 }, start)).toBe(Math.ceil(duration - duration / ads));
    expect(msLeft(crop, { ...field, ads: 1 }, start + 3_600_000)).toBe(Math.ceil(duration - duration / ads - 3_600_000));
    expect(isReady(crop, { ...field, ads }, start)).toBe(true);
    expect(msLeft(crop, { ...field, ads }, start)).toBe(0);
    expect(msLeft(crop, { ...field, ads: ads + 1 }, start + duration)).toBe(0);
  });
});
