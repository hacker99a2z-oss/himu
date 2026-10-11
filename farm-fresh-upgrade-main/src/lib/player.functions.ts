import { createServerFn } from "@tanstack/react-start";
import {
  CROP_KEYS,
  CROP_RULES,
  MIN_WITHDRAW_CENTS,
  PACK_PRICE_CENTS,
  START_WATER,
  WATER_PER_PACK,
  MIN_WATER_BUY,
  MAX_WATER_BUY,
  AD_REWARD_WATER,
  AD_COOLDOWN_MS,
  waterPriceCents,
  referralRewardCents,
  tonNanoForUsd,
  type CropKey,
  type PlayerView,
} from "./rules";

type PlayerDoc = {
  _id: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  balanceCents: number;
  water: number;
  crops: Record<CropKey, number>;
  fields: Record<CropKey, { planted: boolean; watered: boolean }>;
  referredBy: number | null;
  referralCount: number;
  referralEarnedCents: number;
  lastAdAt?: Date;
  createdAt: Date;
};

const initOnly = (d: unknown) => {
  const o = d as { initData?: unknown };
  if (typeof o?.initData !== "string" || o.initData.length > 4096) throw new Error("Invalid input");
  return o as { initData: string };
};
const isCrop = (k: unknown): k is CropKey => typeof k === "string" && (CROP_KEYS as string[]).includes(k);

async function ctx(initData: string) {
  const { verifyInitData } = await import("./tg.server");
  const { getDb } = await import("./db.server");
  const tg = await verifyInitData(initData);
  const db = await getDb();
  return { tg, db, players: db.collection<PlayerDoc>("players") };
}

async function view(db: Awaited<ReturnType<typeof ctx>>["db"], p: PlayerDoc): Promise<PlayerView> {
  const w = await db
    .collection<{ _id: string; telegramId: number; cents: number; address: string; status: string; createdAt: Date }>("withdrawals")
    .find({ telegramId: p._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return {
    balanceCents: p.balanceCents,
    water: p.water,
    crops: p.crops,
    fields: p.fields,
    referralCount: p.referralCount,
    referralEarnedCents: p.referralEarnedCents,
    nextAdAt: p.lastAdAt ? p.lastAdAt.getTime() + AD_COOLDOWN_MS : null,
    withdrawals: w.map((x) => ({ id: String(x._id), cents: x.cents, address: x.address, status: x.status, date: x.createdAt.toISOString() })),
  };
}

const rec = <T,>(fn: () => T) => Object.fromEntries(CROP_KEYS.map((k) => [k, fn()])) as Record<CropKey, T>;

export const loadPlayer = createServerFn({ method: "POST" })
  .inputValidator(initOnly)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const existing = await players.findOneAndUpdate(
      { _id: tg.id },
      { $set: { firstName: tg.first_name, username: tg.username ?? null, photoUrl: tg.photo_url ?? null } },
      { returnDocument: "after" },
    );
    if (existing) return view(db, existing);
    // Referral only for brand-new players (prevents re-assigning referrers later)
    const m = tg.start_param?.match(/^ref_(\d+)$/);
    let refId = m && Number(m[1]) !== tg.id ? Number(m[1]) : null;
    if (!refId) {
      const saved = await db.collection<{ _id: number; ref: number }>("start_refs").findOne({ _id: tg.id });
      if (saved && saved.ref !== tg.id) refId = saved.ref;
    }
    let referredBy: number | null = null;
    if (refId) {
      const r = await players.updateOne({ _id: refId }, { $inc: { referralCount: 1 } });
      if (r.matchedCount) referredBy = refId;
    }
    const doc: PlayerDoc = {
      _id: tg.id,
      firstName: tg.first_name,
      username: tg.username ?? null,
      photoUrl: tg.photo_url ?? null,
      balanceCents: 0,
      water: START_WATER,
      crops: rec(() => 0),
      fields: rec(() => ({ planted: false, watered: false })),
      referredBy,
      referralCount: 0,
      referralEarnedCents: 0,
      createdAt: new Date(),
    };
    try {
      await players.insertOne(doc);
    } catch {
      /* concurrent first load */
    }
    return view(db, (await players.findOne({ _id: tg.id }))!);
  });

export const tapField = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; crop?: unknown };
    if (!isCrop(o.crop)) throw new Error("Invalid field");
    return o as { initData: string; crop: CropKey };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const k = data.crop;
    const need = CROP_RULES[k].waterNeed;
    const f = `fields.${k}`;
    let msg = "";
    let res = await players.findOneAndUpdate(
      { _id: tg.id, [`${f}.planted`]: false },
      { $set: { [`${f}.planted`]: true, [`${f}.watered`]: false } },
      { returnDocument: "after" },
    );
    if (res) msg = "planted";
    if (!res) {
      res = await players.findOneAndUpdate(
        { _id: tg.id, [`${f}.planted`]: true, [`${f}.watered`]: false, water: { $gte: need } },
        { $set: { [`${f}.watered`]: true }, $inc: { water: -need } },
        { returnDocument: "after" },
      );
      if (res) msg = "watered";
    }
    if (!res) {
      res = await players.findOneAndUpdate(
        { _id: tg.id, [`${f}.planted`]: true, [`${f}.watered`]: true },
        { $set: { [`${f}.planted`]: false, [`${f}.watered`]: false }, $inc: { [`crops.${k}`]: 1 } },
        { returnDocument: "after" },
      );
      if (res) msg = "harvested";
    }
    if (!res) {
      const p = await players.findOne({ _id: tg.id });
      if (!p) throw new Error("Player not found");
      return { ok: false as const, message: `Need ${need} water drops — buy more water`, player: await view(db, p) };
    }
    return { ok: true as const, message: msg, player: await view(db, res) };
  });

export const sellCrops = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; crop?: unknown; qty?: unknown };
    if (!isCrop(o.crop)) throw new Error("Invalid crop");
    if (!Number.isInteger(o.qty) || (o.qty as number) < 1 || (o.qty as number) > 1_000_000) throw new Error("Invalid amount");
    return o as { initData: string; crop: CropKey; qty: number };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const earn = CROP_RULES[data.crop].sellCents * data.qty;
    const res = await players.findOneAndUpdate(
      { _id: tg.id, [`crops.${data.crop}`]: { $gte: data.qty } },
      { $inc: { [`crops.${data.crop}`]: -data.qty, balanceCents: earn } },
      { returnDocument: "after" },
    );
    if (!res) throw new Error("Not enough crops");
    return { earnedCents: earn, player: await view(db, res) };
  });

export const getGramQuote = createServerFn({ method: "GET" }).handler(async () => {
  const { getTonUsd } = await import("./ton.server");
  const price = await getTonUsd();
  return { tonUsd: price, nano: tonNanoForUsd(PACK_PRICE_CENTS, price).toString(), water: WATER_PER_PACK };
});

export const createWaterOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; water?: unknown };
    if (!Number.isInteger(o.water) || (o.water as number) < MIN_WATER_BUY || (o.water as number) > MAX_WATER_BUY)
      throw new Error(`Buy at least ${MIN_WATER_BUY} water`);
    return o as { initData: string; water: number };
  })
  .handler(async ({ data }) => {
    const { tg, db } = await ctx(data.initData);
    const { getTonUsd, MERCHANT_ADDRESS } = await import("./ton.server");
    const price = await getTonUsd();
    const nano = tonNanoForUsd(waterPriceCents(data.water), price).toString();
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const comment = `FC-${id}`;
    await db.collection("orders").insertOne({ _id: id as never, telegramId: tg.id, water: data.water, nano, comment, status: "pending", createdAt: new Date() });
    return { orderId: id, address: MERCHANT_ADDRESS, nano, comment };
  });

export const confirmWaterOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; orderId?: unknown };
    if (typeof o.orderId !== "string" || !/^[a-f0-9]{16}$/.test(o.orderId)) throw new Error("Invalid order");
    return o as { initData: string; orderId: string };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const orders = db.collection<{ _id: string; telegramId: number; water?: number; nano: string; comment: string; status: string; txHash?: string }>("orders");
    const order = await orders.findOne({ _id: data.orderId, telegramId: tg.id });
    if (!order) throw new Error("Order not found");
    if (order.status === "paid") return { paid: true, player: await view(db, (await players.findOne({ _id: tg.id }))!) };
    const { findPayment } = await import("./ton.server");
    const hash = await findPayment(order.comment, BigInt(order.nano));
    if (!hash) return { paid: false, player: null };
    const used = await orders.findOne({ txHash: hash });
    if (used) throw new Error("Payment already used");
    const claim = await orders.updateOne({ _id: order._id, status: "pending" }, { $set: { status: "paid", txHash: hash, paidAt: new Date() } });
    if (claim.modifiedCount) {
      const me = await players.findOneAndUpdate({ _id: tg.id }, { $inc: { water: order.water ?? WATER_PER_PACK } }, { returnDocument: "after" });
      const reward = referralRewardCents(waterPriceCents(order.water ?? WATER_PER_PACK));
      if (me?.referredBy) await players.updateOne({ _id: me.referredBy }, { $inc: { balanceCents: reward, referralEarnedCents: reward } });
    }
    return { paid: true, player: await view(db, (await players.findOne({ _id: tg.id }))!) };
  });

export const withdraw = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; cents?: unknown; address?: unknown };
    if (!Number.isInteger(o.cents) || (o.cents as number) < MIN_WITHDRAW_CENTS || (o.cents as number) > 10_000_000) throw new Error("Minimum withdraw is $0.10");
    if (typeof o.address !== "string" || o.address.length > 100) throw new Error("Connect your Tonkeeper wallet");
    return o as { initData: string; cents: number; address: string };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const { normalizeAddress, getTonUsd } = await import("./ton.server");
    let address: string;
    try {
      address = normalizeAddress(data.address);
    } catch {
      throw new Error("Invalid wallet address");
    }
    const price = await getTonUsd();
    const nano = tonNanoForUsd(data.cents, price);
    const res = await players.findOneAndUpdate({ _id: tg.id, balanceCents: { $gte: data.cents } }, { $inc: { balanceCents: -data.cents } });
    if (!res) throw new Error("Not enough balance");
    // Queue it — the auto payout worker sends it in a batch within ~1 minute.
    await db.collection("withdrawals").insertOne({
      _id: crypto.randomUUID() as never,
      telegramId: tg.id,
      cents: data.cents,
      nano: nano.toString(),
      address,
      status: "pending",
      createdAt: new Date(),
    });
    const { kickPayouts } = await import("./payout.server");
    kickPayouts();
    return { player: await view(db, (await players.findOne({ _id: tg.id }))!) };
  });

export const claimAdReward = createServerFn({ method: "POST" })
  .inputValidator(initOnly)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const now = new Date();
    const res = await players.findOneAndUpdate(
      { _id: tg.id, $or: [{ lastAdAt: { $exists: false } }, { lastAdAt: { $lte: new Date(now.getTime() - AD_COOLDOWN_MS) } }] },
      { $inc: { water: AD_REWARD_WATER }, $set: { lastAdAt: now } },
      { returnDocument: "after" },
    );
    if (!res) throw new Error("Please wait for the timer to finish");
    return view(db, res);
  });
