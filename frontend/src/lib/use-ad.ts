import { useEffect, useMemo, useState, useRef } from "react";
import { getAdsgramInitOptions, type AdsgramInitOptions } from "./ads";
import { useGame } from "./game";
import { gameApi } from "./api";
import type { CropKey } from "@shared/rules";

type AdsgramShowResult = { done: boolean; description: string; state: string; error: boolean };
type AdsgramEvent = "onStart";
type AdController = {
  show: () => Promise<AdsgramShowResult>;
  addEventListener?: (event: AdsgramEvent, callback: () => void) => void;
  removeEventListener?: (event: AdsgramEvent, callback: () => void) => void;
  destroy?: () => void;
};

const FAILED_SESSION_KEY_PREFIX = "adsgram:failed-session:";

function failedSessionKey(userId: number | string) {
  return `${FAILED_SESSION_KEY_PREFIX}${userId}`;
}

function readFailedSessionId(userId: number | string): string | undefined {
  try {
    const value = window.localStorage.getItem(failedSessionKey(userId));
    return value && /^[a-f0-9]{32}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function rememberFailedSession(userId: number | string, sessionId: string) {
  try {
    window.localStorage.setItem(failedSessionKey(userId), sessionId);
  } catch {
    // Server TTL is the fallback if browser storage is unavailable.
  }
}

function forgetFailedSession(userId: number | string, sessionId: string) {
  try {
    const key = failedSessionKey(userId);
    if (window.localStorage.getItem(key) === sessionId) window.localStorage.removeItem(key);
  } catch {
    // Leaving the ID stored is safe: server cancellation is idempotent and session-specific.
  }
}

/**
 * Apply a timeout only while the SDK is still trying to load the first ad frame.
 * Never time out a video after onStart: doing so could cancel a legitimate reward
 * while the user is watching. AdsGram documents onStart and destroy on AdController.
 */
function showAdWithStartupTimeout(controller: AdController, onStart?: () => void, timeoutMs = 30000) {
  if (!controller.addEventListener || !controller.removeEventListener) return controller.show();

  let started = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const handleStart = () => {
    started = true;
    if (timeout) clearTimeout(timeout);
    onStart?.();
  };

  controller.addEventListener("onStart", handleStart);
  const showPromise = controller.show();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (started) return;
      try { controller.destroy?.(); } catch { /* continue cleanup */ }
      reject({ description: "Ad loading timed out", state: "load", error: true });
    }, timeoutMs);
  });

  return Promise.race([showPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
    controller.removeEventListener?.("onStart", handleStart);
  });
}

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
  const adsgramOptions = useMemo(() => getAdsgramInitOptions(), []);

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
    target: "field" | "contest" = "field",
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
        const result = await showAdWithStartupTimeout(AdControllerRef.current);
        if (!result.done) throw new Error(target === "contest" ? "Watch the ad till the end to get +1 point" : "Watch the ad till the end to speed up growth");
        return "test";
      }

      // If an earlier ad failed before playback, make the backend cancel that exact
      // reservation before it checks whether another session is already pending.
      const failedSessionId = readFailedSessionId(game.user.id);
      const session = await gameApi.startAdSession(game.initData, crop, part, target, failedSessionId);
      if (failedSessionId) forgetFailedSession(game.user.id, failedSessionId);
      sessionId = session.sessionId;

      // AdsGram identifies callbacks by Telegram user ID, not session ID.
      // Do not resume a pending reward from a different button/target.
      if (session.target !== target || session.crop !== crop || session.part !== part) {
        sessionId = undefined;
        const pendingTarget = session.target === "contest"
          ? "the giveaway point button"
          : `the ${session.crop} field, part ${session.part + 1}`;
        throw new Error(`A rewarded ad is already pending for ${pendingTarget}. Return to that button to finish verification.`);
      }

      if (!session.resumed) {
        try {
          const result = await showAdWithTimeout(AdControllerRef.current);
          if (!result.done) throw new Error(target === "contest" ? "Watch the ad till the end to get +1 point" : "Watch the ad till the end to speed up growth");
        } catch (error) {
          // Persist first. If this network call fails or the app closes, the next
          // Watch Ads click will ask the backend to cancel this exact failed reservation.
          rememberFailedSession(game.user.id, sessionId);
          try {
            await gameApi.cancelAdSession(game.initData, sessionId);
            forgetFailedSession(game.user.id, sessionId);
          } catch {
            // Keep the stored ID for recovery on the next attempt.
          }
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
