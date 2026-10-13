import { useEffect, useState } from "react";
import { ADSGRAM_BLOCK_ID } from "./ads";
import { useGame } from "./game";
import type { CropKey } from "./rules";

type AdController = { show: () => Promise<{ done: boolean; description: string }> };

/** Shared rewarded-ad logic: 3-minute cooldown timer + Adsgram playback with server-side verification. */
export function useRewardedAd() {
  const game = useGame();
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const nextAdAt = game.state?.nextAdAt ?? null;
  const left = nextAdAt ? Math.max(0, nextAdAt - now) : 0;

  useEffect(() => {
    if (!left) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const secs = Math.ceil(left / 1000);
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  /** Plays an ad; AdsGram server calls our reward URL for verification. */
  const play = async (crop: CropKey, part: number, onDone: () => Promise<void>) => {
    if (loading || left) return;
    if (!game.initData) throw new Error("Open the game inside Telegram");
    if (!game.user.id) throw new Error("User ID not available");

    const sdk = (window as unknown as { Adsgram?: { init: (o: { blockId: string; rewardUrl?: string }) => AdController } }).Adsgram;
    if (!sdk) throw new Error("Ads are not available right now");
    setLoading(true);
    try {
      // Pass rewardUrl to AdsGram - it will call this URL when ad is completed
      const rewardUrl = `${window.location.origin}/reward?userid=${game.user.id}&crop=${crop}&part=${part}`;
      const result = await sdk.init({ blockId: ADSGRAM_BLOCK_ID, rewardUrl }).show();
      if (!result.done) throw new Error("Watch the ad till the end to speed up growth");

      await onDone();
      setNow(Date.now());
    } finally {
      setLoading(false);
    }
  };

  return { loading, left, timer, play };
}
