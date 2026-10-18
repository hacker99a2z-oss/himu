import { timingSafeEqual } from "node:crypto";
import {
  AD_COOLDOWN_MS,
  CROP_KEYS,
  CROP_RULES,
  fieldParts,
  isFieldPart,
  isReady,
  type CropKey,
} from "../../shared/rules.js";
import { getDb } from "./db.js";
import { loadPlayer } from "./player.functions.js";
import { verifyInitData } from "./tg.js";

const SESSION_TTL_MS = 10 * 60 * 1000;

type AdSession = {
  _id: number;
  sessionId: string;
  crop: CropKey;
  part: number;
  status: "pending" | "verified" | "cancelled" | "expired";
  expiresAt: Date;
  createdAt: Date;
  verifiedAt?: Date;
};

type Player = {
  _id: number;
  fields?: Record<string, unknown>;
  lastAdAt?: Date;
  lastAdSessionId?: string;
};

function validInput(input: unknown): input is { initData: string; crop: CropKey; part: number } {
  if (!input || typeof input !== "object") return false;
  const data = input as Record<string, unknown>;
  const crop = data["crop"];
  const part = data["part"];
  return (
    typeof data["initData"] === "string" &&
    data["initData"].length <= 4096 &&
    typeof crop === "string" &&
    (CROP_KEYS as string[]).includes(crop) &&
    isFieldPart(crop as CropKey, part)
  );
}

function safeSecretEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startAdSession(input: unknown) {
  if (!validInput(input)) throw new Error("Invalid ad request");
  if (!process.env["ADSGRAM_REWARD_SECRET"]) throw new Error("Rewarded ads are not configured");

  const tg = await verifyInitData(input.initData);
  const db = await getDb();
  const players = db.collection<Player>("players");
  const player = await players.findOne({ _id: tg.id });
  if (!player) throw new Error("Player not found");

  const now = new Date();
  if (player.lastAdAt && player.lastAdAt.getTime() + AD_COOLDOWN_MS > now.getTime()) {
    throw new Error("Please wait for the timer to finish");
  }
  const field = fieldParts(input.crop, player.fields?.[input.crop] as never)[input.part];
  if (!field?.planted) throw new Error("Plant a seed first");
  if (isReady(input.crop, field, now.getTime())) throw new Error("Already fully grown — tap to harvest");

  const sessions = db.collection<AdSession>("ad_sessions");
  await sessions.updateOne(
    { _id: tg.id, status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );

  const sessionId = crypto.randomUUID().replace(/-/g, "");
  try {
    await sessions.updateOne(
      { _id: tg.id, status: { $ne: "pending" } },
      {
        $set: {
          sessionId,
          crop: input.crop,
          part: input.part,
          status: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new Error("An ad is already waiting for verification");
    }
    throw error;
  }

  return { sessionId };
}

export async function cancelAdSession(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Invalid ad request");
  const data = input as { initData?: unknown; sessionId?: unknown };
  if (typeof data.initData !== "string" || data.initData.length > 4096 ||
      typeof data.sessionId !== "string" || !/^[a-f0-9]{32}$/.test(data.sessionId)) {
    throw new Error("Invalid ad request");
  }
  const tg = await verifyInitData(data.initData);
  const db = await getDb();
  await db.collection<AdSession>("ad_sessions").updateOne(
    { _id: tg.id, sessionId: data.sessionId, status: "pending" },
    { $set: { status: "cancelled" } },
  );
  return { cancelled: true };
}

export async function getAdSessionStatus(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Invalid ad request");
  const data = input as { initData?: unknown; sessionId?: unknown };
  if (typeof data.initData !== "string" || data.initData.length > 4096 ||
      typeof data.sessionId !== "string" || !/^[a-f0-9]{32}$/.test(data.sessionId)) {
    throw new Error("Invalid ad request");
  }
  const tg = await verifyInitData(data.initData);
  const db = await getDb();
  const session = await db.collection<AdSession>("ad_sessions").findOne({
    _id: tg.id,
    sessionId: data.sessionId,
  });
  if (!session) throw new Error("Ad session not found");
  if (session.status === "pending" && session.expiresAt.getTime() <= Date.now()) {
    await db.collection<AdSession>("ad_sessions").updateOne(
      { _id: tg.id, sessionId: data.sessionId, status: "pending" },
      { $set: { status: "expired" } },
    );
    return { verified: false, expired: true, player: null };
  }
  if (session.status !== "verified") return { verified: false, expired: session.status === "expired", player: null };
  return { verified: true, expired: false, player: await loadPlayer({ data: { initData: data.initData } }) };
}

/** AdsGram server callback. The URL secret is configured in its publisher dashboard, never in the browser. */
export async function verifyAdsgramReward(userId: string | null, suppliedSecret: string | null) {
  const expectedSecret = process.env["ADSGRAM_REWARD_SECRET"];
  if (!expectedSecret || !suppliedSecret || !safeSecretEqual(suppliedSecret, expectedSecret)) {
    return { status: 403, message: "Forbidden" };
  }
  if (!userId || !/^\d{1,20}$/.test(userId)) return { status: 400, message: "Invalid user" };
  const telegramId = Number(userId);
  if (!Number.isSafeInteger(telegramId)) return { status: 400, message: "Invalid user" };

  const db = await getDb();
  const sessions = db.collection<AdSession>("ad_sessions");
  const session = await sessions.findOne({ _id: telegramId });
  if (!session) return { status: 404, message: "No pending ad" };
  if (session.status === "verified") return { status: 200, message: "Already verified" };
  if (session.status !== "pending" || session.expiresAt.getTime() <= Date.now()) {
    return { status: 410, message: "No active ad session" };
  }

  const players = db.collection<Player>("players");
  for (let attempt = 0; attempt < 3; attempt++) {
    const player = await players.findOne({ _id: telegramId });
    if (!player) return { status: 404, message: "Player not found" };

    // A retry after the player update but before the session update must not award twice.
    if (player.lastAdSessionId === session.sessionId) {
      await sessions.updateOne(
        { _id: telegramId, sessionId: session.sessionId, status: "pending" },
        { $set: { status: "verified", verifiedAt: new Date() } },
      );
      return { status: 200, message: "Verified" };
    }

    const now = Date.now();
    if (player.lastAdAt && player.lastAdAt.getTime() + AD_COOLDOWN_MS > now) {
      return { status: 429, message: "Ad cooldown active" };
    }
    if (!CROP_KEYS.includes(session.crop) || !isFieldPart(session.crop, session.part)) {
      return { status: 400, message: "Invalid ad session" };
    }

    const list = fieldParts(session.crop, player.fields?.[session.crop] as never);
    const field = list[session.part]!;
    if (!field.planted || isReady(session.crop, field, now)) {
      return { status: 409, message: "Field is no longer eligible" };
    }
    list[session.part] = { ...field, ads: Math.min(CROP_RULES[session.crop].adsNeed, field.ads + 1) };
    const update = await players.updateOne(
      {
        _id: telegramId,
        [`fields.${session.crop}`]: player.fields?.[session.crop] ?? { $exists: false },
        lastAdAt: player.lastAdAt ?? { $exists: false },
        lastAdSessionId: player.lastAdSessionId ?? { $exists: false },
      } as never,
      {
        $set: {
          [`fields.${session.crop}`]: list,
          lastAdAt: new Date(now),
          lastAdSessionId: session.sessionId,
        },
      },
    );
    if (!update.modifiedCount) continue;

    await sessions.updateOne(
      { _id: telegramId, sessionId: session.sessionId, status: "pending" },
      { $set: { status: "verified", verifiedAt: new Date(now) } },
    );
    return { status: 200, message: "Verified" };
  }
  return { status: 409, message: "Try again" };
}
