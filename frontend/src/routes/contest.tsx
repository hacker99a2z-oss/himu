import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Loader2, PlayCircle } from "lucide-react";
import { GameShell } from "@/components/GameShell";
import { Button } from "@/components/ui/button";
import { gameApi } from "@/lib/api";
import { CROPS, haptic, money, useGame } from "@/lib/game";
import { useRewardedAd } from "@/lib/use-ad";
import type { ContestView } from "@shared/rules";

export const Route = createFileRoute("/contest")({
  head: () => ({
    meta: [
      { title: "Giveaways — Farm City" },
      { name: "description", content: "Join the Farm City giveaway with 1 corn, watch ads to earn points and share the prize by rank." },
      { property: "og:title", content: "Giveaways — Farm City" },
      { property: "og:description", content: "Every entrant wins a share of the giveaway, ranked by points." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Giveaways,
});

// Preserve sub-cent shares in the giveaway display while leaving all other money displays unchanged.
const prizeMoney = (cents: number) => `$${(cents / 100).toFixed(4).replace(/(\.\d{2})0+$/, "$1").replace(/(\.\d{3})0$/, "$1")}`;

function Giveaways() {
  const game = useGame();
  const [c, setC] = useState<ContestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(() => {
    if (!game.initData) return;
    gameApi.loadContest(game.initData).then(setC, (e) => toast.error(e instanceof Error ? e.message : "Could not load giveaways"));
  }, [game.initData]);

  useEffect(load, [load]);
  useEffect(() => {
    // Refresh ranks, points and prizes so they update when others join or watch ads.
    const r = setInterval(load, 20_000);
    return () => clearInterval(r);
  }, [load]);

  const corn = game.state?.crops.corn ?? 0;
  const entered = c?.entered ?? false;
  const goal = c?.goalPoints ?? 2000;
  const total = c?.totalPoints ?? 0;
  const pct = Math.min(100, (total / goal) * 100);

  const enter = async () => {
    if (!game.initData) return void toast.error("Open the game inside Telegram");
    haptic();
    setBusy(true);
    try {
      const r = await gameApi.enterContest(game.initData);
      setC(r.contest);
      game.setState(r.player);
      toast.success("You joined the giveaway! 🎁");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell hideProfile>
      <section className="card-farm mb-4 overflow-hidden">
        <div className="bg-gold-gradient p-5 text-gold-foreground">
          <div className="flex items-center gap-2">
            <Gift className="h-6 w-6" />
            <h1 className="font-display text-2xl font-bold">Giveaways $$</h1>
          </div>
          <div className="mt-4 rounded-xl bg-background/85 p-3 text-foreground shadow-inner">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-extrabold tracking-wider text-muted-foreground">POINTS</span>
              <span className="font-display text-lg font-bold tabular-nums">
                {total}/{goal}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="card-farm p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-display text-base font-bold">Giveaways</span>
          <span className="text-xs font-bold text-muted-foreground">
            Distribution amount <span className="font-display text-sm text-primary">{money(c?.distributionCents ?? 500)}</span>
          </span>
        </div>
        {!c ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : c.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No one has joined yet. Be the first!</p>
        ) : (
          <ol className="space-y-1.5">
            {c.rows.map((r) => (
              <li
                key={`${r.rank}-${r.name}`}
                className={`rounded-xl px-3 py-2 ${r.me ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 font-display font-bold tabular-nums">{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                  <span className="font-display text-sm font-bold tabular-nums">{r.prizeCents > 0 ? `+${prizeMoney(r.prizeCents)}` : "—"}</span>
                </div>
                <div className="mt-1 pl-8">
                  <span className="text-[11px] font-bold opacity-80">{r.points} points</span>
                  {r.me && <PointButton onPoint={load} />}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Ranked by points. Everyone who joins gets a share when the points reach {goal}.
        </p>
      </section>

      {c && !entered && !dismissed && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-foreground/40 px-6" onClick={() => setDismissed(true)}>
          <div className="card-farm w-full max-w-xs p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <img src={CROPS.corn.image} alt="" className="mx-auto h-14 w-14" />
            <p className="mt-2 font-display text-lg font-bold">Join with 1 corn</p>
            <p className="text-sm text-muted-foreground">Give 1 harvested corn to join this giveaway.</p>
            <p className="mt-1 text-xs font-bold">You have {corn} 🌽</p>
            <button className="btn-game btn-gold mt-3 w-full" disabled={busy || corn < 1} onClick={enter}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Give 1 🌽 & Join"}
            </button>
            <button className="mt-2 text-xs font-bold text-muted-foreground" onClick={() => setDismissed(true)}>
              Maybe later
            </button>
          </div>
        </div>
      )}
      {c && !entered && dismissed && (
        <button className="btn-game btn-gold fixed inset-x-0 bottom-28 z-20 mx-auto w-56" onClick={() => setDismissed(false)}>
          Join with 1 🌽
        </button>
      )}
    </GameShell>
  );
}

/** "1 Ad = +1": same rewarded-ad flow and shared 3-minute timer as the field buttons. */
function PointButton({ onPoint }: { onPoint: () => void }) {
  const ad = useRewardedAd();
  const watch = async () => {
    try {
      const result = await ad.play("wheat", 0, async () => {
        toast.success("+1 point 🎁");
        onPoint();
      }, "contest");
      if (result === "test") toast.message("Test ad played. AdsGram debug ads do not grant points.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ad could not be played");
    }
  };
  return (
    <Button
      className="btn-game btn-gold mt-1.5 flex h-auto w-full gap-1 px-2 py-1 text-xs"
      disabled={ad.loading || ad.left > 0}
      onClick={watch}
    >
      {ad.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
      {ad.left > 0 ? ad.timer : "1 Ad = +1"}
    </Button>
  );
}
