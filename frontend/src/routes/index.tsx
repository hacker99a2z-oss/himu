import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, PlayCircle } from "lucide-react";
import { GameShell, SectionTitle } from "@/components/GameShell";
import { unlockCrop } from "@/lib/unlock";
import { Button } from "@/components/ui/button";
import { UNLOCK_CENTS, FIELD_PART_COUNTS, GROW_STAGES, growStage, isReady, msLeft } from "@shared/rules";
import { useRewardedAd } from "@/lib/use-ad";
import { CROPS, CROP_KEYS, haptic, useGame, type CropKey } from "@/lib/game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Farm City — Grow, harvest & earn" },
      { name: "description", content: "Plant seeds, grow your fields, harvest crops and earn in Farm City, a Telegram farming game." },
      { property: "og:title", content: "Farm City — Grow, harvest & earn" },
      { property: "og:description", content: "Plant seeds, grow your fields and harvest crops in Farm City." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

/** Ticking clock aligned to the server's time. */
function useNow() {
  const game = useGame();
  const serverNow = game.state?.serverNow;
  const offset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

function Home() {
  return (
    <GameShell>
      <section className="card-farm mb-5 p-4">
        <SectionTitle kicker="YOUR BAG" title="Seeds" />
        <div className="grid grid-cols-5 gap-2">
          {CROP_KEYS.map((k) => (
            <SeedTile key={k} k={k} />
          ))}
        </div>
      </section>

      <SectionTitle kicker="YOUR LAND" title="Fields" />
      <p className="-mt-2 mb-3 text-sm text-muted-foreground">
        Seeds are unlimited. Tap a field to plant, then wait or watch ads to speed up growth, then tap again to harvest.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {CROP_KEYS.map((k) => (
          <FieldCard key={k} k={k} />
        ))}
      </div>
    </GameShell>
  );
}

function SeedTile({ k }: { k: CropKey }) {
  const game = useGame();
  const [busy, setBusy] = useState(false);
  const unlocked = game.state?.unlocked[k] ?? !UNLOCK_CENTS[k];
  const price = UNLOCK_CENTS[k];

  const onUnlock = async () => {
    if (busy || unlocked) return;
    haptic();
    setBusy(true);
    try {
      const r = await unlockCrop(game, k);
      if (r.ok) toast.success(r.message);
      else toast.message(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment cancelled");
    } finally {
      setBusy(false);
    }
  };

  if (unlocked) {
    return (
      <div className="relative flex flex-col items-center rounded-xl bg-secondary p-2">
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] font-extrabold text-primary-foreground">∞</span>
        <img src={CROPS[k].image} alt="" className="h-10 w-10" />
        <span className="text-[11px] font-bold">{CROPS[k].name}</span>
      </div>
    );
  }
  return (
    <button
      type="button" disabled={busy} onClick={onUnlock}
      aria-label={`Unlock ${CROPS[k].name} for $${((price ?? 0) / 100).toFixed(2)}`}
      className="relative flex flex-col items-center rounded-xl bg-secondary p-2"
    >
      <span className="relative">
        <img src={CROPS[k].image} alt="" className="h-10 w-10 opacity-40 grayscale" />
        <span className="absolute inset-0 flex items-center justify-center">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />}
        </span>
      </span>
      <span className="text-[11px] font-bold">{CROPS[k].name}</span>
      <span className="btn-game btn-gold mt-1 w-full px-1 py-0.5 text-[10px]">{((price ?? 0) / 100).toFixed(2)} $</span>
    </button>
  );
}

function FieldCard({ k }: { k: CropKey }) {
  return (
    <div className={`card-farm p-2 ${k === "pumpkin" ? "col-span-2" : ""}`}>
      <div className="mb-1.5 px-1"><span className="font-display text-sm font-semibold">{CROPS[k].name} Field</span></div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: FIELD_PART_COUNTS[k] }, (_, part) => <FieldPart key={part} k={k} part={part} />)}
      </div>
    </div>
  );
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function FieldPart({ k, part }: { k: CropKey; part: number }) {
  const game = useGame();
  const now = useNow();
  const crop = CROPS[k];
  const field = game.state?.fields[k]?.[part] ?? { planted: false, plantedAt: 0, ads: 0 };
  const ready = isReady(k, field, now);
  const stage = growStage(k, field, now);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const onTap = async () => {
    if (busy) return;
    haptic();
    if (field.planted && !ready) return;
    setBusy(true);
    const res = await game.tap(k, part);
    setBusy(false);
    if (!res.ok) {
      setShake(true);
      setTimeout(() => setShake(false), 300);
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
  };

  // Plant grows in 10 steps: small sprout -> full crop
  const scale = 0.45 + (0.55 * stage) / GROW_STAGES;

  return (
    <div className="flex flex-col gap-1.5">
        <Button
          type="button" variant="ghost" disabled={busy}
          aria-label={`${crop.name} field part ${part + 1}: ${ready ? "harvest" : field.planted ? "growing" : "plant"}`}
          onClick={onTap}
          className={`relative flex h-auto min-h-24 w-full flex-col gap-0.5 overflow-hidden rounded-lg bg-soil-gradient px-1 py-2 text-3xl shadow-inner hover:bg-soil ${shake ? "animate-shake" : ""}`}
        >
          {field.planted && !ready && (
            <span className="rounded-full bg-background/80 px-1.5 text-[10px] font-bold tabular-nums text-foreground">
              ⏳ {fmt(msLeft(k, field, now))}
            </span>
          )}
          <span className="flex min-h-10 items-end">
            {field.planted && (
              <span key={stage} className="inline-block animate-pop-in transition-transform duration-700" style={{ transform: `scale(${scale})` }}>
                <span className={`inline-block ${ready ? "animate-sway" : ""}`}>{stage >= GROW_STAGES ? crop.emoji : "🌱"}</span>
              </span>
            )}
          </span>
          {ready ? (
            <span className="rounded-full bg-gold-gradient px-1 py-0.5 text-[9px] font-extrabold text-gold-foreground">HARVEST</span>
          ) : !field.planted ? (
            <span className="text-[10px] font-bold text-primary-foreground">Empty</span>
          ) : null}
        </Button>
        <AdPanel k={k} part={part} active={field.planted && !ready} />
    </div>
  );
}

/** Shown under every field part: growth-by-ads progress + "Watch Ads to Skip Time" (shared 3-min cooldown). */
function AdPanel({ k, part, active }: { k: CropKey; part: number; active: boolean }) {
  const game = useGame();
  const ad = useRewardedAd();
  const crop = CROPS[k];
  const field = game.state?.fields[k]?.[part];
  const ads = field?.ads ?? 0;
  const pct = Math.min(100, (ads / crop.adsNeed) * 100);

  const watch = async () => {
    if (!active) return;
    try {
      const result = await ad.play(k, part, async (verifiedCrop) => {
        toast.success(`${CROPS[verifiedCrop].name} grew a little 🌱`);
      });
      if (result === "test") {
        toast.message("Test ad played. AdsGram debug ads do not grant crop growth.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ad could not be played");
    }
  };

  return (
    <div className={`rounded-lg bg-secondary p-1.5 transition-opacity ${active ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
          <div className="h-full bg-primary transition-all" style={{ width: `${active ? pct : 0}%` }} />
        </div>
        <span className="text-[9px] font-bold tabular-nums">{active ? ads : 0}/{crop.adsNeed}</span>
      </div>
      <Button
        className="btn-game mt-1.5 h-auto w-full gap-1 px-1 py-1 text-[10px] leading-tight"
        disabled={!active || ad.loading || ad.left > 0}
        onClick={watch}
      >
        {ad.loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 shrink-0" />}
        {ad.left > 0 ? ad.timer : "Watch Ads to Skip Time"}
      </Button>
    </div>
  );
}
