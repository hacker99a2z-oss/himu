import { createServerFn } from "./server-fn.js";
import {
  CROP_KEYS,
  WITHDRAWAL_HISTORY_LIMIT,
  DAILY_REWARDS,
  DAILY_SEEDS,
  fieldParts,
  isFieldPart,
  isReady,
  dailyStatus,
  dayKey,
  type Field,
  type Daily,
  CROP_RULES,
  MIN_WITHDRAW_CENTS,
  MIN_SEED_BUY,
  MAX_SEED_BUY,
  AD_COOLDOWN_MS,
  seedPriceCents,
  referralRewardCents,
  tonNanoForUsd,
  type CropKey,
  type PlayerView,
  type ContestView,
  UNLOCK_CENTS,
  isUnlocked,
  isLockable,
  CONTEST_ENTRY_CENTS,
  CONTEST_SHOWN,
  CONTEST_PRIZE_WEIGHTS,
  contestPrizeCents,
  weekKey,
  weekEnd,
} from "../../shared/rules.js";

type PlayerDoc = {
  _id: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  balanceCents: number;
  seeds?: Partial<Record<CropKey, number>>;
  unlocked?: Partial<Record<CropKey, boolean>>;
  crops: Record<CropKey, number>;
  fields: Record<CropKey, unknown>;
  daily?: Daily;
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
  const { verifyInitData } = await import("./tg.js");
  const { getDb } = await import("./db.js");
  const tg = await verifyInitData(initData);
  const db = await getDb();
  return { tg, db, players: db.collection<PlayerDoc>("players") };
}

const parts = (p: PlayerDoc, k: CropKey) => fieldParts(k, p.fields?.[k] as never);

async function view(db: Awaited<ReturnType<typeof ctx>>["db"], p: PlayerDoc): Promise<PlayerView> {
  const w = await db
    .collection<{ _id: string; telegramId: number; cents: number; address: string; status: string; createdAt: Date }>("withdrawals")
    .find({ telegramId: p._id })
    .sort({ createdAt: -1 })
    .limit(WITHDRAWAL_HISTORY_LIMIT)
    .toArray();
  const now = Date.now();
  return {
    balanceCents: p.balanceCents,
    seeds: rec((k) => p.seeds?.[k] ?? 0),
    unlocked: rec((k) => isUnlocked(k, p.unlocked)),
    crops: p.crops,
    fields: rec((k) => parts(p, k)),
    daily: dailyStatus(p.daily, now),
    referralCount: p.referralCount,
    referralEarnedCents: p.referralEarnedCents,
    nextAdAt: p.lastAdAt ? p.lastAdAt.getTime() + AD_COOLDOWN_MS : null,
    serverNow: now,
    withdrawals: w.map((x) => ({ id: String(x._id), cents: x.cents, address: x.address, status: x.status, date: x.createdAt.toISOString() })),
  };
}

const rec = <T,>(fn: (k: CropKey) => T) => Object.fromEntries(CROP_KEYS.map((k) => [k, fn(k)])) as Record<CropKey, T>;

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
      seeds: rec(() => 0),
      crops: rec(() => 0),
      fields: rec((k) => fieldParts(k)),
      daily: { streak: 0, lastDay: null },
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

const fieldInput = (d: unknown) => {
  const o = initOnly(d) as { initData: string; crop?: unknown; part?: unknown };
  if (!isCrop(o.crop)) throw new Error("Invalid field");
  const part = o.part ?? 0;
  if (!isFieldPart(o.crop, part)) throw new Error("Invalid field part");
  return { initData: o.initData, crop: o.crop, part };
};

/** Tap a field part: plant (uses 1 seed) when empty, harvest when fully grown. */
export const tapField = createServerFn({ method: "POST" })
  .inputValidator(fieldInput)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const k = data.crop;
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await players.findOne({ _id: tg.id });
      if (!p) throw new Error("Player not found");
      const list = parts(p, k);
      const f = list[data.part]!;
      const now = Date.now();
      // Optimistic lock on the raw saved field value
      const filter = { _id: tg.id, [`fields.${k}`]: p.fields?.[k] ?? { $exists: false } } as never;
      if (!f.planted) {
        // Unlimited seeds: free crops always, paid crops once unlocked.
        if (!isUnlocked(k, p.unlocked)) return { ok: false as const, message: `Unlock ${k} seeds first`, player: await view(db, p) };
        list[data.part] = { planted: true, plantedAt: now, ads: 0 };
        const res = await players.findOneAndUpdate(filter, { $set: { [`fields.${k}`]: list } }, { returnDocument: "after" });
        if (res) return { ok: true as const, message: "planted", player: await view(db, res) };
        continue;
      }
      if (!isReady(k, f, now)) return { ok: false as const, message: "growing", player: await view(db, p) };
      list[data.part] = { planted: false, plantedAt: 0, ads: 0 };
      const res = await players.findOneAndUpdate(filter, { $set: { [`fields.${k}`]: list }, $inc: { [`crops.${k}`]: 1 } }, { returnDocument: "after" });
      if (res) return { ok: true as const, message: "harvested", player: await view(db, res) };
    }
    throw new Error("Busy, try again");
  });

/** Rewarded ad finished for one growing plant: +1 ad progress (shared 3-minute cooldown). */
export const claimFieldAd = createServerFn({ method: "POST" })
  .inputValidator(fieldInput)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const k = data.crop;
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await players.findOne({ _id: tg.id });
      if (!p) throw new Error("Player not found");
      const now = Date.now();
      if (p.lastAdAt && p.lastAdAt.getTime() + AD_COOLDOWN_MS > now) throw new Error("Please wait for the timer to finish");
      const list = parts(p, k);
      const f = list[data.part]!;
      if (!f.planted) throw new Error("Plant a seed first");
      if (isReady(k, f, now)) throw new Error("Already fully grown — tap to harvest");
      list[data.part] = { ...f, ads: Math.min(CROP_RULES[k].adsNeed, f.ads + 1) };
      const res = await players.findOneAndUpdate(
        { _id: tg.id, [`fields.${k}`]: p.fields?.[k] ?? { $exists: false }, lastAdAt: p.lastAdAt ?? { $exists: false } } as never,
        { $set: { [`fields.${k}`]: list, lastAdAt: new Date(now) } },
        { returnDocument: "after" },
      );
      if (res) return view(db, res);
    }
    throw new Error("Busy, try again");
  });

/** Weekly daily reward: one claim per UTC day; missing a day restarts at day 1. */
export const claimDaily = createServerFn({ method: "POST" })
  .inputValidator(initOnly)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const p = await players.findOne({ _id: tg.id });
    if (!p) throw new Error("Player not found");
    const now = Date.now();
    const st = dailyStatus(p.daily, now);
    if (!st.canClaim) throw new Error("Already claimed today — come back tomorrow");
    const day = st.done + 1;
    const crop = DAILY_REWARDS[day - 1]!;
    const res = await players.findOneAndUpdate(
      { _id: tg.id, "daily.lastDay": p.daily?.lastDay ?? null } as never,
      { $set: { daily: { streak: day, lastDay: dayKey(now) } }, $inc: { [`seeds.${crop}`]: DAILY_SEEDS } },
      { returnDocument: "after" },
    );
    if (!res) throw new Error("Already claimed today");
    return { day, crop, player: await view(db, res) };
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
    // Weekly contest ranking counts dollars earned from selling this week.
    await db.collection<{ _id: string }>("contest_entries").updateOne(
      { _id: `${weekKey(Date.now())}:${tg.id}` },
      { $inc: { soldCents: earn } },
    );
    return { earnedCents: earn, player: await view(db, res) };
  });

export const getGramQuote = createServerFn({ method: "GET" }).handler(async () => {
  const { getTonUsd } = await import("./ton.js");
  const price = await getTonUsd();
  // nano Gram for $1 — client scales it by the price in cents
  return { tonUsd: price, nanoPerDollar: tonNanoForUsd(100, price).toString() };
});

export const createSeedOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; crop?: unknown; qty?: unknown };
    if (!isCrop(o.crop)) throw new Error("Invalid seed");
    if (!Number.isInteger(o.qty) || (o.qty as number) < MIN_SEED_BUY || (o.qty as number) > MAX_SEED_BUY)
      throw new Error(`Buy at least ${MIN_SEED_BUY} seeds`);
    return o as { initData: string; crop: CropKey; qty: number };
  })
  .handler(async ({ data }) => {
    const { tg, db } = await ctx(data.initData);
    const { getTonUsd, MERCHANT_ADDRESS } = await import("./ton.js");
    const price = await getTonUsd();
    const nano = tonNanoForUsd(seedPriceCents(data.crop, data.qty), price).toString();
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const comment = `FC-${id}`;
    await db.collection("orders").insertOne({ _id: id as never, telegramId: tg.id, crop: data.crop, qty: data.qty, nano, comment, status: "pending", createdAt: new Date() });
    return { orderId: id, address: MERCHANT_ADDRESS, nano, comment };
  });

/** One-time unlock of a paid crop, paid in Gram via Tonkeeper. */
export const createUnlockOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; crop?: unknown };
    if (!isCrop(o.crop) || !isLockable(o.crop)) throw new Error("This seed is already free");
    return o as { initData: string; crop: CropKey };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const p = await players.findOne({ _id: tg.id });
    if (!p) throw new Error("Player not found");
    if (isUnlocked(data.crop, p.unlocked)) throw new Error("Already unlocked");
    const { getTonUsd, MERCHANT_ADDRESS } = await import("./ton.js");
    const price = await getTonUsd();
    const cents = UNLOCK_CENTS[data.crop]!;
    const nano = tonNanoForUsd(cents, price).toString();
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const comment = `FC-${id}`;
    await db.collection("orders").insertOne({ _id: id as never, type: "unlock", telegramId: tg.id, crop: data.crop, cents, nano, comment, status: "pending", createdAt: new Date() });
    return { orderId: id, address: MERCHANT_ADDRESS, nano, comment };
  });

export const confirmSeedOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = initOnly(d) as { initData: string; orderId?: unknown };
    if (typeof o.orderId !== "string" || !/^[a-f0-9]{16}$/.test(o.orderId)) throw new Error("Invalid order");
    return o as { initData: string; orderId: string };
  })
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    const orders = db.collection<{ _id: string; type?: string; cents?: number; telegramId: number; crop?: CropKey; qty?: number; nano: string; comment: string; status: string; txHash?: string }>("orders");
    const order = await orders.findOne({ _id: data.orderId, telegramId: tg.id });
    if (!order) throw new Error("Order not found");
    console.log("confirmSeedOrder - order found:", order);
    if (order.status === "paid") return { paid: true, player: await view(db, (await players.findOne({ _id: tg.id }))!) };
    const isUnlock = order.type === "unlock";
    if (!order.crop || (!isUnlock && !order.qty)) throw new Error("Old order type");
    const { findPayment } = await import("./ton.js");
    const hash = await findPayment(order.comment, BigInt(order.nano));
    console.log("confirmSeedOrder - payment hash:", hash);
    if (!hash) return { paid: false, player: null };
    const used = await orders.findOne({ txHash: hash });
    if (used) throw new Error("Payment already used");
    const claim = await orders.updateOne({ _id: order._id, status: "pending" }, { $set: { status: "paid", txHash: hash, paidAt: new Date() } });
    console.log("confirmSeedOrder - order updated:", claim.modifiedCount);
    if (claim.modifiedCount) {
      const me = isUnlock
        ? await players.findOneAndUpdate({ _id: tg.id }, { $set: { [`unlocked.${order.crop}`]: true } }, { returnDocument: "after" })
        : await players.findOneAndUpdate({ _id: tg.id }, { $inc: { [`seeds.${order.crop}`]: order.qty! } }, { returnDocument: "after" });
      console.log("confirmSeedOrder - player updated:", me);
      const paidCents = isUnlock ? (order.cents ?? UNLOCK_CENTS[order.crop] ?? 0) : seedPriceCents(order.crop, order.qty!);
      const reward = referralRewardCents(paidCents);
      if (me?.referredBy && reward > 0) await players.updateOne({ _id: me.referredBy }, { $inc: { balanceCents: reward, referralEarnedCents: reward } });
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
    const { normalizeAddress, getTonUsd } = await import("./ton.js");
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
    const { kickPayouts } = await import("./payout.js");
    kickPayouts();
    return { player: await view(db, (await players.findOne({ _id: tg.id }))!) };
  });

type EntryDoc = { _id: string; week: string; telegramId: number; name: string; soldCents: number; joinedAt: Date };
type ContestDoc = { _id: string; entrants: number; settled?: boolean };

/** Pays out every finished week that has not been settled yet (idempotent, first caller wins). */
async function settleFinishedWeeks(db: Awaited<ReturnType<typeof ctx>>["db"]) {
  const contests = db.collection<ContestDoc>("contests");
  const current = weekKey(Date.now());
  const open = await contests.find({ _id: { $lt: current }, settled: { $ne: true } }).toArray();
  for (const c of open) {
    const lock = await contests.updateOne({ _id: c._id, settled: { $ne: true } }, { $set: { settled: true, settledAt: new Date() } });
    if (!lock.modifiedCount) continue;
    const pool = c.entrants * CONTEST_ENTRY_CENTS;
    const top = await db.collection<EntryDoc>("contest_entries").find({ week: c._id }).sort({ soldCents: -1, joinedAt: 1 }).limit(CONTEST_PRIZE_WEIGHTS.length).toArray();
    for (const [i, e] of top.entries()) {
      const prize = contestPrizeCents(i + 1, pool, top.length);
      if (prize > 0) await db.collection<PlayerDoc>("players").updateOne({ _id: e.telegramId }, { $inc: { balanceCents: prize } });
      await db.collection<EntryDoc>("contest_entries").updateOne({ _id: e._id }, { $set: { rank: i + 1, prizeCents: prize } as never });
    }
  }
}

async function contestView(db: Awaited<ReturnType<typeof ctx>>["db"], me: number): Promise<ContestView> {
  const now = Date.now();
  const week = weekKey(now);
  const c = await db.collection<ContestDoc>("contests").findOne({ _id: week });
  const entrants = c?.entrants ?? 0;
  const pool = entrants * CONTEST_ENTRY_CENTS;
  const entries = db.collection<EntryDoc>("contest_entries");
  const entered = !!(await entries.findOne({ _id: `${week}:${me}` }));
  const top = entered ? await entries.find({ week }).sort({ soldCents: -1, joinedAt: 1 }).limit(CONTEST_SHOWN).toArray() : [];
  return {
    week,
    endsAt: weekEnd(now),
    serverNow: now,
    poolCents: pool,
    entered,
    entrants,
    rows: top.map((e, i) => ({ rank: i + 1, name: e.name, soldCents: e.soldCents, prizeCents: contestPrizeCents(i + 1, pool, entrants), me: e.telegramId === me })),
  };
}

export const loadContest = createServerFn({ method: "POST" })
  .inputValidator(initOnly)
  .handler(async ({ data }) => {
    const { tg, db } = await ctx(data.initData);
    await settleFinishedWeeks(db);
    return contestView(db, tg.id);
  });

/** Enter this week's contest by giving 1 harvested pumpkin; adds 5 cents to the pool. */
export const enterContest = createServerFn({ method: "POST" })
  .inputValidator(initOnly)
  .handler(async ({ data }) => {
    const { tg, db, players } = await ctx(data.initData);
    await settleFinishedWeeks(db);
    const now = Date.now();
    const week = weekKey(now);
    const entries = db.collection<EntryDoc>("contest_entries");
    const id = `${week}:${tg.id}`;
    if (!(await entries.findOne({ _id: id }))) {
      const paid = await players.findOneAndUpdate({ _id: tg.id, "crops.pumpkin": { $gte: 1 } }, { $inc: { "crops.pumpkin": -1 } }, { returnDocument: "after" });
      if (!paid) throw new Error("You need 1 harvested pumpkin to enter");
      const name = [tg.first_name].filter(Boolean).join(" ") || (tg.username ? `@${tg.username}` : `Farmer ${tg.id}`);
      try {
        await entries.insertOne({ _id: id, week, telegramId: tg.id, name, soldCents: 0, joinedAt: new Date(now) });
        await db.collection<ContestDoc>("contests").updateOne({ _id: week }, { $inc: { entrants: 1 } }, { upsert: true });
      } catch {
        // Concurrent double entry: give the pumpkin back.
        await players.updateOne({ _id: tg.id }, { $inc: { "crops.pumpkin": 1 } });
      }
    }
    const player = await view(db, (await players.findOne({ _id: tg.id }))!);
    return { contest: await contestView(db, tg.id), player };
  });
