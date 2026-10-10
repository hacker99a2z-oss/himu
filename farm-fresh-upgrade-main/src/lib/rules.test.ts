import { describe, expect, it } from "vitest";
import { MIN_WATER_BUY, AD_REWARD_WATER, AD_COOLDOWN_MS, waterPriceCents, CROP_RULES, MIN_WITHDRAW_CENTS, WATER_PER_PACK, PACK_PRICE_CENTS, referralRewardCents, sellValueCents, nextFieldAction } from "./rules";

describe("game rules", () => {
  it("water needed per crop", () => {
    expect([CROP_RULES.wheat, CROP_RULES.corn, CROP_RULES.carrot, CROP_RULES.tomato, CROP_RULES.pumpkin].map((c) => c.waterNeed)).toEqual([100, 200, 280, 360, 450]);
  });
  it("sell prices: wheat $0.01 ... pumpkin $0.05", () => {
    expect(sellValueCents("wheat", 1)).toBe(1);
    expect(sellValueCents("pumpkin", 1)).toBe(5);
    expect(sellValueCents("carrot", 10)).toBe(30);
  });
  it("minimum withdraw is $0.10", () => expect(MIN_WITHDRAW_CENTS).toBe(10));
  it("1000 water costs $1", () => {
    expect(WATER_PER_PACK).toBe(1000);
    expect(PACK_PRICE_CENTS).toBe(100);
  });
  it("referrer gets 10% of water purchase", () => expect(referralRewardCents(100)).toBe(10));
  it("one tap = one step on one field", () => {
    expect(nextFieldAction({ planted: false, watered: false })).toBe("plant");
    expect(nextFieldAction({ planted: true, watered: false })).toBe("water");
    expect(nextFieldAction({ planted: true, watered: true })).toBe("harvest");
  });
});

describe("water buying and ads", () => {
  it("minimum purchase is 100 water", () => expect(MIN_WATER_BUY).toBe(100));
  it("100 water costs 10 cents", () => expect(waterPriceCents(100)).toBe(10));
  it("ad gives 10 water", () => expect(AD_REWARD_WATER).toBe(10));
  it("ad cooldown is 3 minutes", () => expect(AD_COOLDOWN_MS).toBe(180000));
});
