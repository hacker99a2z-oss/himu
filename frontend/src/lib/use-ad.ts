import { useEffect, useMemo, useState, useRef } from "react";
import { ADSGRAM_BLOCK_ID } from "./ads";
import { useGame } from "./game";
import { gameApi } from "./api";
import type { CropKey } from "@shared/rules";

type AdController = { 
  show: () => Promise<{ done: boolean; description: string; state: string; error: boolean }>; 
};

/** Shared rewarded-ad logic: 3-minute cooldown timer + Adsgram playback with server-side verification. */
export function useRewardedAd() {
  const game = useGame();
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Align to server time so the shared cooldown is identical on every field, even after reopening the app.
  const serverNow = game.state?.serverNow;
  const offset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);
  const nextAdAt = game.state?.nextAdAt ?? null;
  const left = nextAdAt ? Math.max(0, nextAdAt - (now + offset)) : 0;
  const AdControllerRef = useRef<AdController | undefined>(undefined);

  // Initialize AdsGram controller once
  useEffect(() => {
    const sdk = (window as unknown as { Adsgram?: { init: (o: { blockId: string }) => AdController } }).Adsgram;
    if (sdk) {
      AdControllerRef.current = sdk.init({ blockId: ADSGRAM_BLOCK_ID });
    }
  }, []);

  useEffect(() => {
    if (!left) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const secs = Math.ceil(left / 1000);
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  /** Rewards are applied only after AdsGram's authenticated server callback is confirmed. */
  const play = async (crop: CropKey, part: number, onDone: () => Promise<void>) => {
    if (loading || left) return;
    if (!game.initData) throw new Error("Open the game inside Telegram");
    if (!game.user.id) throw new Error("User ID not available");

    if (!AdControllerRef.current) throw new Error("Ads are not available right now");
    setLoading(true);
    let sessionId: string | undefined;
    try {
      const session = await gameApi.startAdSession(game.initData, crop, part);
      sessionId = session.sessionId;
      const result = await AdControllerRef.current.show();
      if (!result.done) {
        await gameApi.cancelAdSession(game.initData, sessionId).catch(() => undefined);
        sessionId = undefined;
        throw new Error("Watch the ad till the end to speed up growth");
      }

      for (let attempt = 0; attempt < 45; attempt++) {
        const status = await gameApi.getAdSessionStatus(game.initData, sessionId);
        if (status.verified && status.player) {
          game.setState(status.player);
          await onDone();
          setNow(Date.now());
          return;
        }
        if (status.expired) throw new Error("Ad verification expired. Please try again.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("Ad watched; waiting for AdsGram server verification. Please reopen the field shortly.");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Ad playback failed");
    } finally {
      setLoading(false);
    }
  };

  return { loading, left, timer, play };
}
