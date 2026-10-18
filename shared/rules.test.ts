import { describe, expect, it } from "vitest";
import { CROP_RULES, GROW_MS, dailyStatus, dayKey, fieldParts, growStage, isReady, seedPriceCents } from "./rules.js";

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
    expect(growStage("wheat", f, GROW_MS / 10)).toBe(1);
    expect(isReady("wheat", f, GROW_MS)).toBe(true);
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

import { REFERRAL_PERCENT, UNLOCK_CENTS, contestPrizeCents, isUnlocked, referralRewardCents, weekStart, CONTEST_PRIZE_PERCENT } from "./rules.js";
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
  it("top 10 split the whole pool", () => {
    expect(CONTEST_PRIZE_PERCENT.reduce((a, b) => a + b, 0)).toBe(100);
    expect(contestPrizeCents(1, 100)).toBe(25);
    expect(contestPrizeCents(11, 100)).toBe(0);
  });
  it("weeks start Monday UTC", () => {
    expect(new Date(weekStart(Date.parse("2026-10-18T17:00:00Z"))).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
