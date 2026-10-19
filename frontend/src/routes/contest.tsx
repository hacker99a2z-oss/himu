import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trophy } from "lucide-react";
import { GameShell } from "@/components/GameShell";
import { gameApi } from "@/lib/api";
import { CROPS, haptic, money, useGame } from "@/lib/game";
import type { ContestView } from "@shared/rules";

export const Route = createFileRoute("/contest")({
  head: () => ({
    meta: [
      { title: "Weekly Contest — Farm City" },
      { name: "description", content: "Enter the Farm City weekly contest with a pumpkin, sell the most and win the prize pool." },
      { property: "og:title", content: "Weekly Contest — Farm City" },
      { property: "og:description", content: "Top 10 sellers of the week share the prize pool." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Contest,
});

const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
};

// Preserve sub-cent shares in the contest display while leaving all other money displays unchanged.
const prizeMoney = (cents: number) => `$${(cents / 100).toFixed(4).replace(/(\.\d{2})0+$/, "$1").replace(/(\.\d{3})0$/, "$1")}`;

function Contest() {
  const game = useGame();
  const [c, setC] = useState<ContestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const serverNow = c?.serverNow;
  const offset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);

  const load = useCallback(() => {
    if (!game.initData) return;
    gameApi.loadContest(game.initData).then(setC, (e) => toast.error(e instanceof Error ? e.message : "Could not load contest"));
  }, [game.initData]);

  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    // Refresh ranks and pool so prizes update when new players join.
    const r = setInterval(load, 20_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  const left = c ? c.endsAt - (now + offset) : 0;
  useEffect(() => {
    if (c && left <= 0) load();
  }, [c, left <= 0, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const pumpkins = game.state?.crops.pumpkin ?? 0;
  const entered = c?.entered ?? false;

  const enter = async () => {
    if (!game.initData) return void toast.error("Open the game inside Telegram");
    haptic();
    setBusy(true);
    try {
      const r = await gameApi.enterContest(game.initData);
      setC(r.contest);
      game.setState(r.player);
      toast.success("You joined this week's contest! 🏆");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enter");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameShell hideProfile>
      <div className="relative">
        <div className={entered ? "" : "pointer-events-none select-none blur-sm"} aria-hidden={!entered}>
          <section className="card-farm mb-4 overflow-hidden">
            <div className="relative bg-gold-gradient p-5 pb-10 text-gold-foreground">
              <div className="flex items-center gap-2">
                <Trophy className="h-6 w-6" />
                <h1 className="font-display text-2xl font-bold">Weekly Contest</h1>
              </div>
              <p className="mt-2 text-sm font-semibold">
                Time left: <span className="tabular-nums">{c ? fmtLeft(left) : "…"}</span>
              </p>
              <p className="absolute bottom-3 right-4 font-display text-2xl font-bold">{money(c?.poolCents ?? 0)}</p>
            </div>
          </section>

          <section className="card-farm p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-xs font-bold text-muted-foreground">
              <span>Contesters</span>
              <span>Prize</span>
            </div>
            <ol className="space-y-1.5">
              {(c?.rows.length ? c.rows : placeholderRows).map((r) => (
                <li
                  key={r.rank}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 ${r.me ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                >
                  <span className="w-6 font-display font-bold tabular-nums">{r.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.name}</span>
                    <span className="block text-[10px] font-bold opacity-70">Sold {money(r.soldCents)}</span>
                  </span>
                  <span className="font-display text-sm font-bold tabular-nums">{r.prizeCents > 0 ? `+${prizeMoney(r.prizeCents)}` : "—"}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Ranked by $ earned selling crops this week. Top 10 share the pool when the timer ends.
            </p>
          </section>
        </div>

        {c && !entered && (
          <div className="absolute inset-x-0 top-24 z-10 flex justify-center px-4">
            <div className="card-farm w-full max-w-xs p-5 text-center">
              <img src={CROPS.pumpkin.image} alt="" className="mx-auto h-14 w-14" />
              <p className="mt-2 font-display text-lg font-bold">Enter with 1 pumpkin</p>
              <p className="text-sm text-muted-foreground">Give 1 harvested pumpkin to join this week's contest.</p>
              <p className="mt-1 text-xs font-bold">You have {pumpkins} 🎃</p>
              <button className="btn-game btn-gold mt-3 w-full" disabled={busy || pumpkins < 1} onClick={enter}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Give 1 🎃 & Enter"}
              </button>
            </div>
          </div>
        )}
        {!c && (
          <div className="absolute inset-x-0 top-24 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
      </div>
    </GameShell>
  );
}

const placeholderRows = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: "Farmer", soldCents: 0, prizeCents: 0, me: false }));
