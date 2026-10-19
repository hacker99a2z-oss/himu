import { gameApi } from "./api";
import { CROPS, type CropKey, useGame } from "./game";
import { commentPayload, getWallet } from "./wallet";

/** Pay the unlock price in Gram through Tonkeeper (same flow the old Buy button used), then confirm server-side. */
export async function unlockCrop(game: ReturnType<typeof useGame>, crop: CropKey): Promise<{ ok: boolean; message: string }> {
  if (!game.initData) return { ok: false, message: "Open the game inside Telegram" };
  const ui = await getWallet();
  if (!ui.connected) {
    await ui.openModal();
    return { ok: false, message: "Connect Tonkeeper, then tap the lock again" };
  }
  const order = await gameApi.createUnlockOrder(game.initData, crop);
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [{ address: order.address, amount: order.nano, payload: await commentPayload(order.comment) }],
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await gameApi.confirmSeedOrder(game.initData, order.orderId);
    if (r.paid && r.player) {
      game.setState(r.player);
      return { ok: true, message: `${CROPS[crop].name} unlocked — unlimited seeds! 🎉` };
    }
  }
  return { ok: false, message: "Payment not confirmed yet. It will unlock once it arrives — reopen the app later." };
}
