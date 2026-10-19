import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gameApi, game, show } = vi.hoisted(() => ({
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
}));

vi.mock("@/lib/api", () => ({ gameApi }));
vi.mock("@/lib/game", () => ({ useGame: () => game }));

import { useRewardedAd } from "@/lib/use-ad";

describe("rewarded ad session handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    game.state = { serverNow: Date.now(), nextAdAt: null };
    gameApi.startAdSession.mockResolvedValue({
      sessionId: "a".repeat(32),
      resumed: false,
      crop: "wheat",
      part: 0,
    });
    gameApi.cancelAdSession.mockResolvedValue({ cancelled: true });
    Object.defineProperty(window, "Adsgram", {
      configurable: true,
      value: { init: vi.fn(() => ({ show })) },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "Adsgram");
  });

  it("cancels an unfinished session when AdsGram has no ad available", async () => {
    show.mockRejectedValue({ description: "banner not found", state: "load", error: true });
    const { result } = renderHook(() => useRewardedAd());

    await act(async () => {
      await expect(result.current.play("wheat", 0, vi.fn())).rejects.toThrow(
        "No ad is available right now. Please try again shortly.",
      );
    });

    expect(gameApi.cancelAdSession).toHaveBeenCalledWith("signed-telegram-init-data", "a".repeat(32));
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
