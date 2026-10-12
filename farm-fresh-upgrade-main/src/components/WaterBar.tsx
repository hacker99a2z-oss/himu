import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Droplet, PlayCircle, Gem, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGame } from "@/lib/game";
import { claimAdReward } from "@/lib/player.functions";
import { AD_REWARD_WATER } from "@/lib/rules";
import { ADSGRAM_BLOCK_ID } from "@/lib/ads";
import { BuyWater } from "./BuyWater";
import { Button } from "./ui/button";

type AdController = { show: () => Promise<{ done: boolean; description: string }> };

export function WaterBar() {
  const game = useGame();
  const claim = useServerFn(claimAdReward);
  const [buyOpen, setBuyOpen] = useState(false);
  const [loadingAd, setLoadingAd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const nextAdAt = game.state?.nextAdAt ?? null;
  const left = nextAdAt ? Math.max(0, nextAdAt - now) : 0;

  useEffect(() => {
    if (!left) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const showAd = async () => {
    if (loadingAd || left) return;
    if (!game.initData) return void toast.error("Open the game inside Telegram");
    const sdk = (window as unknown as { Adsgram?: { init: (o: { blockId: string }) => AdController } }).Adsgram;
    if (!sdk) return void toast.error("Ads are not available right now");
    setLoadingAd(true);
    try {
      const result = await sdk.init({ blockId: ADSGRAM_BLOCK_ID }).show();
      if (!result.done) throw new Error("Watch the ad till the end to get water");
      const p = await claim({ data: { initData: game.initData } });
      game.setState(p);
      setNow(Date.now());
      toast.success(`+${AD_REWARD_WATER} water 💧`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ad could not be played");
    } finally {
      setLoadingAd(false);
    }
  };

  const secs = Math.ceil(left / 1000);
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <>
      <div className="card-farm mb-4 flex flex-wrap items-center gap-1 p-2 text-sm font-semibold">
        <Droplet className="ml-1 h-5 w-5 fill-water text-water" />
        <span className="flex-1 font-display text-lg">{(game.state?.water ?? 0).toLocaleString("en-US")}</span>
        <span className="text-xs text-muted-foreground">Get water by</span>
        <Button className="btn-game gap-1 px-2 py-1.5 text-xs" disabled={loadingAd || left > 0} onClick={showAd}>
          {loadingAd ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {left > 0 ? timer : <>1 Ads= {AD_REWARD_WATER}<Droplet aria-label="water" className="h-3 w-3 fill-current" /></>}
        </Button>
        <span className="text-[10px] font-bold text-muted-foreground">OR</span>
        <Button className="btn-game btn-gold px-2 py-1.5 text-xs" onClick={() => setBuyOpen(true)}>
          <Gem className="h-4 w-4" /> Gram
        </Button>
      </div>
      <BuyWater open={buyOpen} onOpenChange={setBuyOpen} />
    </>
  );
}
