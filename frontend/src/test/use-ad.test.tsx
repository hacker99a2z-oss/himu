import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gameApi, game, show, adsgramInit } = vi.hoisted(() => ({
  gameApi: {
    startAdSession: vi.fn(),
    getAdSessionStatus: vi.fn(),
    cancelAdSession: vi.fn(),
  },
  game: {
    state: { serverNow: Date.now(), nextAdAt: null },
    initData: "signed-telegram-init-data",
    user: { id: 1234 },
    setState: vi.fn(),
  },
  show: vi.fn(),
  adsgramInit: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ gameApi }));
vi.mock("@/lib/game", () => ({ useGame: () => game }));

import { useRewardedAd } from "@/lib/use-ad";
import { getAdsgramInitOptions } from "@/lib/ads";

describe("rewarded ad session handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEV", false);
    game.state = { serverNow: Date.now(), nextAdAt: null };
    gameApi.startAdSession.mockResolvedValue({
      sessionId: "a".repeat(32),
      resumed: false,
      crop: "wheat",
      part: 0,
    });
    gameApi.cancelAdSession.mockResolvedValue({ cancelled: true });
    adsgramInit.mockImplementation(() => ({ show }));
    Object.defineProperty(window, "Adsgram", {
      configurable: true,
      value: { init: adsgramInit },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(window, "Adsgram");
  });

  it("uses AdsGram's test creative only in development", () => {
    expect(getAdsgramInitOptions(true)).toEqual({
      blockId: "int-41387",
      debug: true,
      debugBannerType: "RewardedVideo",
    });
    expect(getAdsgramInitOptions(false)).toEqual({ blockId: "41655" });
  });

  it("plays the development test ad without creating or rewarding a crop session", async () => {
    vi.stubEnv("DEV", true);
    show.mockResolvedValue({
      done: true,
      description: "completed",
      state: "destroy",
      error: false,
    });
    const onDone = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRewardedAd());

    expect(adsgramInit).toHaveBeenCalledWith({
      blockId: "int-41387",
      debug: true,
      debugBannerType: "RewardedVideo",
    });

    await act(async () => {
      await expect(result.current.play("wheat", 0, onDone)).resolves.toBe("test");
    });

    expect(show).toHaveBeenCalledOnce();
    expect(gameApi.startAdSession).not.toHaveBeenCalled();
    expect(gameApi.getAdSessionStatus).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels an unfinished session when AdsGram has no ad available", async () => {
    show.mockRejectedValue({ description: "banner not found", state: "load", error: true });
    const { result } = renderHook(() => useRewardedAd());

    expect(adsgramInit).toHaveBeenCalledWith(getAdsgramInitOptions(false));

    await act(async () => {
      await expect(result.current.play("wheat", 0, vi.fn())).rejects.toThrow(
        "No ad is available right now. Please try again shortly.",
      );
    });

    expect(gameApi.cancelAdSession).toHaveBeenCalledWith(
      "signed-telegram-init-data",
      "a".repeat(32),
    );
  });

  it("resumes checking a pending session without opening another ad", async () => {
    const player = { balanceCents: 0 };
    gameApi.startAdSession.mockResolvedValue({
      sessionId: "b".repeat(32),
      resumed: true,
      crop: "corn",
      part: 1,
    });
    gameApi.getAdSessionStatus.mockResolvedValue({ verified: true, expired: false, player });
    const onDone = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRewardedAd());

    await act(async () => {
      await result.current.play("wheat", 0, onDone);
    });

    expect(show).not.toHaveBeenCalled();
    expect(game.setState).toHaveBeenCalledWith(player);
    expect(onDone).toHaveBeenCalledWith("corn");
  });
});
