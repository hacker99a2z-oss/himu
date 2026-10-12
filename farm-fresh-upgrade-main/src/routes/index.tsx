import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { GameShell, SectionTitle } from "@/components/GameShell";
import { Button } from "@/components/ui/button";
import { FIELD_PART_COUNTS } from "@/lib/rules";
import { WaterBar } from "@/components/WaterBar";
import { CROPS, CROP_KEYS, haptic, useGame, type CropKey } from "@/lib/game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Farm City — Grow, harvest & earn" },
      { name: "description", content: "Plant seeds, water your fields, harvest crops and earn in Farm City, a Telegram farming game." },
      { property: "og:title", content: "Farm City — Grow, harvest & earn" },
      { property: "og:description", content: "Plant seeds, water your fields and harvest crops in Farm City." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <GameShell>
      <WaterBar />
      <section className="card-farm mb-5 p-4">
        <SectionTitle kicker="UNLIMITED" title="Seeds" />
        <div className="grid grid-cols-5 gap-2">
          {CROP_KEYS.map((k) => (
            <div key={k} className="flex flex-col items-center rounded-xl bg-secondary p-2">
              <img src={CROPS[k].image} alt="" className="h-10 w-10" />
              <span className="text-[11px] font-bold">{CROPS[k].name}</span>
            </div>
          ))}
        </div>
      </section>

      <SectionTitle kicker="YOUR LAND" title="Fields" />
      <p className="-mt-2 mb-3 text-sm text-muted-foreground">Tap a field to plant, tap again to water, then harvest.</p>
      <div className="grid grid-cols-2 gap-3">
        {CROP_KEYS.map((k) => (
          <FieldCard key={k} k={k} />
        ))}
      </div>
    </GameShell>
  );
}

function FieldCard({ k }: { k: CropKey }) {
  return <div className={`card-farm p-2 ${k === "pumpkin" ? "col-span-2" : ""}`}>
    <div className="mb-1.5 px-1"><span className="font-display text-sm font-semibold">{CROPS[k].name} Field</span></div>
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: FIELD_PART_COUNTS[k] }, (_, part) => <FieldPart key={part} k={k} part={part} />)}
    </div>
  </div>;
}

function FieldPart({ k, part }: { k: CropKey; part: number }) {
  const game = useGame();
  const crop = CROPS[k];
  const field = game.state?.fields[k]?.[part] ?? { planted: false, watered: false };
  const ready = field.planted && field.watered;
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drops, setDrops] = useState<number[]>([]);

  const onTap = async () => {
    if (busy) return;
    haptic();
    setBusy(true);
    const wasWatering = field.planted && !field.watered;
    const res = await game.tap(k, part);
    setBusy(false);
    if (!res.ok) {
      setShake(true);
      setTimeout(() => setShake(false), 300);
      toast.error(res.message);
      return;
    }
    if (wasWatering) {
      const id = Date.now();
      setDrops((d) => [...d, id]);
      setTimeout(() => setDrops((d) => d.filter((x) => x !== id)), 800);
    }
    toast.success(res.message);
  };

  const stage = ready ? crop.emoji : "🌱";

  return (
    <Button
      type="button" variant="ghost" disabled={busy}
      aria-label={`${crop.name} field part ${part + 1}: ${ready ? "harvest" : field.planted ? "water" : "plant"}`}
      onClick={onTap}
      className={`relative flex h-auto min-h-20 w-full flex-col gap-1 overflow-hidden rounded-lg bg-soil-gradient px-1 py-2 text-3xl shadow-inner hover:bg-soil ${shake ? "animate-shake" : ""}`}
    >
      <span className="min-h-8">
        {field.planted && <span key={stage} className={`inline-block animate-pop-in ${ready ? "animate-sway" : ""}`}>{stage}</span>}
      </span>
      {ready ? <span className="rounded-full bg-gold-gradient px-1 py-0.5 text-[9px] font-extrabold text-gold-foreground">HARVEST</span>
        : field.planted ? <span className="text-[10px] font-bold text-water">💧 {crop.waterNeed}</span>
        : <span className="text-[10px] font-bold text-primary-foreground">Empty</span>}
      {drops.map((id) => (
        <span key={id} className="pointer-events-none absolute left-1/2 top-1/3 animate-float-up text-2xl">
          💧
        </span>
      ))}
    </Button>
  );
}
