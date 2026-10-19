import { useEffect, useMemo, useState, useRef } from "react";
import { getAdsgramInitOptions, type AdsgramInitOptions } from "./ads";
import { useGame } from "./game";
import { gameApi } from "./api";
import type { CropKey } from "@shared/rules";

type AdController = {
  show: () => Promise<{ done: boolean; description: string; state: string; error: boolean }>;
};

function playbackErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const result = error as { description?: unknown; state?: unknown; error?: unknown };
    if (result.description === "banner not found" || result.state === "load") {
      return "No ad is available right now. Please try again shortly.";
    }
    if (typeof result.description === "string" && result.description.trim()) {
      return `The ad could not be completed: ${result.description}`;
    }
  }
  return error instanceof Error ? error.message : "Ad playback failed. Please try again.";
}

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
  const adsgramOptions = useMemo(() => getAdsgramInitOptions(import.meta.env.DEV), []);

  // Initialize AdsGram controller once
  useEffect(() => {
    const sdk = (
      window as unknown as { Adsgram?: { init: (o: AdsgramInitOptions) => AdController } }
    ).Adsgram;
    if (sdk) {
      AdControllerRef.current = sdk.init(adsgramOptions);
    }
  }, [adsgramOptions]);

  useEffect(() => {
    if (!left) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const secs = Math.ceil(left / 1000);
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  /** Rewards are applied only after AdsGram's authenticated server callback is confirmed. */
  const play = async (
    crop: CropKey,
    part: number,
    onDone: (verifiedCrop: CropKey) => Promise<void>,
  ) => {
    if (loading || left) return undefined;
    if (!game.initData) throw new Error("Open the game inside Telegram");
    if (!game.user.id) throw new Error("User ID not available");

    if (!AdControllerRef.current) throw new Error("Ads are not available right now");
    setLoading(true);
    let sessionId: string | undefined;
    try {
      // AdsGram debug creatives are for playback testing only and never send a
      // reward callback, so do not reserve or poll a real crop-growth session.
      if (adsgramOptions.debug) {
        const result = await AdControllerRef.current.show();
        if (!result.done) throw new Error("Watch the ad till the end to speed up growth");
        return "test";
      }

      const session = await gameApi.startAdSession(game.initData, crop, part);
      sessionId = session.sessionId;
      if (!session.resumed) {
        try {
          const result = await AdControllerRef.current.show();
          if (!result.done) throw new Error("Watch the ad till the end to speed up growth");
        } catch (error) {
          // AdsGram rejects its show promise for skipped ads, playback errors,
          // and no-fill responses. Release the reservation so the user can retry.
          await gameApi.cancelAdSession(game.initData, sessionId).catch(() => undefined);
          sessionId = undefined;
          throw new Error(playbackErrorMessage(error));
        }
      }

      for (let attempt = 0; attempt < 45; attempt++) {
        const status = await gameApi.getAdSessionStatus(game.initData, sessionId);
        if (status.verified && status.player) {
          game.setState(status.player);
          await onDone(session.crop);
          setNow(Date.now());
          return "rewarded";
        }
        if (status.expired) throw new Error("Ad verification expired. Please try again.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error(
        "Your ad is still waiting for AdsGram's server confirmation. No new ad was opened; tap Watch Ad again to check its status.",
      );
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Ad playback failed");
    } finally {
      setLoading(false);
    }
  };

  return { loading, left, timer, play };
}
