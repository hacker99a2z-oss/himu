import { describe, expect, it } from "vitest";
import { AD_REWARD_WATER, fieldParts, isFieldPart, latestWithdrawals, WITHDRAWAL_HISTORY_LIMIT } from "./rules";
import { publicWithdrawalUrl } from "./withdrawal-links";

describe("requested Farm City changes", () => {
  it.each(["wheat", "corn", "carrot", "tomato"] as const)("%s has exactly two independent parts", (crop) => {
    const parts = fieldParts(crop);
    expect(parts).toEqual([{ planted: false, watered: false }, { planted: false, watered: false }]);
    const first = parts[0];
    if (!first) throw new Error("First part missing");
    first.planted = true;
    expect(parts[1]?.planted).toBe(false);
    expect(isFieldPart(crop, 1)).toBe(true);
    expect(isFieldPart(crop, 2)).toBe(false);
  });
  it("pumpkin has exactly four independent parts", () => {
    const parts = fieldParts("pumpkin");
    expect(parts).toHaveLength(4);
    const chosen = parts[3];
    if (!chosen) throw new Error("Fourth part missing");
    chosen.planted = true;
    expect(parts.map((p) => p.planted)).toEqual([false, false, false, true]);
    expect(isFieldPart("pumpkin", 3)).toBe(true);
    expect(isFieldPart("pumpkin", 4)).toBe(false);
  });
  it("preserves a legacy crop only in the first part", () => {
    expect(fieldParts("wheat", { planted: true, watered: true })).toEqual([
      { planted: true, watered: true }, { planted: false, watered: false },
    ]);
  });
  it("keeps saved parts separate", () => {
    expect(fieldParts("corn", [{ planted: false, watered: false }, { planted: true, watered: false }])).toEqual([
      { planted: false, watered: false }, { planted: true, watered: false },
    ]);
  });
  it("rejects invalid part numbers", () => {
    for (const part of [-1, 0.5, "1", null, NaN]) expect(isFieldPart("wheat", part)).toBe(false);
  });
  it("one completed ad rewards 10 water", () => expect(AD_REWARD_WATER).toBe(10));
  it("history shows the latest five withdrawals, newest first", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: i, date: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
    expect(WITHDRAWAL_HISTORY_LIMIT).toBe(5);
    expect(latestWithdrawals(rows).map((r) => r.id)).toEqual([7, 6, 5, 4, 3]);
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("accepts the public proof and support HTTPS URLs", () => {
    expect(publicWithdrawalUrl("https://t.me/farmcity_proof")).toBe("https://t.me/farmcity_proof");
    expect(publicWithdrawalUrl("https://t.me/farmcity_support")).toBe("https://t.me/farmcity_support");
  });
  it("leaves missing and unsafe link settings disabled", () => {
    for (const value of [undefined, "", "javascript:alert(1)", "http://example.com", "https://user:pass@example.com"]) {
      expect(publicWithdrawalUrl(value)).toBeNull();
    }
  });
});