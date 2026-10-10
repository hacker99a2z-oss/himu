import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { confirmWaterOrder, createWaterOrder, getGramQuote } from "@/lib/player.functions";
import { useGame } from "@/lib/game";
import { MIN_WATER_BUY, MAX_WATER_BUY, waterPriceCents } from "@/lib/rules";
import { commentPayload, getWallet } from "@/lib/wallet";

export function BuyWater({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const game = useGame();
  const quote = useServerFn(getGramQuote);
  const create = useServerFn(createWaterOrder);
  const confirm = useServerFn(confirmWaterOrder);
  const [perPack, setPerPack] = useState<number | null>(null);
  const [amount, setAmount] = useState(String(MIN_WATER_BUY));
  const water = Math.floor(Number(amount) || 0);
  const valid = water >= MIN_WATER_BUY && water <= MAX_WATER_BUY;
  const gram = perPack === null ? null : perPack < 0 ? "—" : ((perPack * water) / 1000).toFixed(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    setPerPack(null);
    void quote().then((q) => setPerPack(Number(q.nano) / 1e9), () => setPerPack(-1));
  }, [open, quote]);

  const buy = async () => {
    if (!game.initData) {
      toast.error("Open the game inside Telegram");
      return;
    }
    if (!valid) {
      toast.error(`Buy at least ${MIN_WATER_BUY} water`);
      return;
    }
    setBusy(true);
    try {
      const ui = await getWallet();
      if (!ui.connected) {
        await ui.openModal();
        toast.message("Connect Tonkeeper, then tap Buy again");
        return;
      }
      const order = await create({ data: { initData: game.initData, water } });
      await ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{ address: order.address, amount: order.nano, payload: await commentPayload(order.comment) }],
      });
      toast.message("Payment sent, confirming…");
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const r = await confirm({ data: { initData: game.initData, orderId: order.orderId } });
        if (r.paid && r.player) {
          game.setState(r.player);
          toast.success(`+${water.toLocaleString("en-US")} water added 💧`);
          onOpenChange(false);
          return;
        }
      }
      toast.error("Payment not confirmed yet. It will be added once it arrives — reopen this later.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment cancelled");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Buy water</DialogTitle>
          <DialogDescription>Pay with Gram from your Tonkeeper wallet.</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-secondary p-4 text-center">
          <p className="text-4xl">💧</p>
          <label className="mt-2 block text-xs font-bold text-muted-foreground">How much water? (min {MIN_WATER_BUY})</label>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_WATER_BUY}
            step={100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-center font-display text-2xl font-bold"
          />
          <div className="mt-2 flex justify-center gap-2">
            {[100, 500, 1000, 5000].map((n) => (
              <button key={n} type="button" className="rounded-full bg-background px-3 py-1 text-xs font-bold" onClick={() => setAmount(String(n))}>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            ${(waterPriceCents(valid ? water : 0) / 100).toFixed(3)} ≈ {gram ?? "…"} Gram
          </p>
          {!valid && <p className="text-xs font-semibold text-destructive">Minimum {MIN_WATER_BUY} water</p>}
        </div>
        <button className="btn-game btn-gold w-full" disabled={busy || !gram || !valid} onClick={buy}>
          {busy ? "Processing…" : "Buy"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
