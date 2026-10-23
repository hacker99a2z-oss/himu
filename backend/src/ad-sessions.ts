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
import { addGiveawayPoint, currentGiveawayRound, giveawayEntryId, loadPlayer } from "./player.functions.js";
import { verifyInitData } from "./tg.js";

const SESSION_TTL_MS = 5 * 60 * 1000;

type AdSession = {
  _id: number;
  sessionId: string;
  crop: CropKey;
  part: number;
  /** "contest" = Giveaways "1 Ad = +1" button; missing/"field" = speed up a field. */
  target?: "field" | "contest";
  round?: number | undefined;
  status: "pending" | "verified" | "cancelled" | "expired";
  /** "reserved" means the SDK hasn't reported that the first ad frame appeared. */
  phase?: "reserved" | "playing";
  startedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  verifiedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
};

type Player = {
  _id: number;
  fields?: Record<string, unknown>;
  lastAdAt?: Date;
  lastAdSessionId?: string;
};

const isSessionExpired = (session: AdSession, now: number) =>
  session.expiresAt.getTime() <= now || session.createdAt.getTime() + SESSION_TTL_MS <= now;

type StartAdInput = {
  initData: string;
  crop: CropKey;
  part: number;
  target?: "field" | "contest";
  /** Only supplied when this browser knows that its previous attempt failed before reward. */
  abandonSessionId?: string;
};

function validInput(input: unknown): input is StartAdInput {
  if (!input || typeof input !== "object") return false;
  const data = input as Record<string, unknown>;
  if (typeof data["initData"] !== "string" || data["initData"].length > 4096) return false;
  if (data["target"] !== undefined && data["target"] !== "field" && data["target"] !== "contest") return false;
  if (data["abandonSessionId"] !== undefined &&
      (typeof data["abandonSessionId"] !== "string" || !/^[a-f0-9]{32}$/.test(data["abandonSessionId"]))) return false;
  if (data["target"] === "contest") return true;
  const crop = data["crop"];
  const part = data["part"];
  return typeof crop === "string" && (CROP_KEYS as string[]).includes(crop) &&
    isFieldPart(crop as CropKey, part);
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
  const sessions = db.collection<AdSession>("ad_sessions");

  // A previous ad can fail before AdsGram displays anything. If the client could
  // not reach the cancel endpoint at that moment, let the next click cancel only
  // that exact session before we check for any other active session.
  if (input.abandonSessionId) {
    const abandoned = await sessions.updateOne(
      { _id: tg.id, sessionId: input.abandonSessionId, status: "pending" },
      { $set: { status: "cancelled", cancelledAt: now, cancelReason: "client_playback_failed" } },
    );
    if (abandoned.modifiedCount) {
      console.info("[adsgram] Failed playback session cancelled on retry");
    }
  }

  await sessions.updateOne(
    {
      _id: tg.id,
      status: "pending",
      $or: [
        { expiresAt: { $lte: now } },
        { createdAt: { $lte: new Date(now.getTime() - SESSION_TTL_MS) } },
      ],
    },
    { $set: { status: "expired" } },
  );

  // AdsGram identifies reward callbacks by Telegram user ID, not by session ID.
  // Keep one live session per user and let the client resume checking it rather
  // than opening a second ad that could be credited to the wrong field.
  const activeSession = await sessions.findOne({
    _id: tg.id,
    status: "pending",
    expiresAt: { $gt: now },
    createdAt: { $gt: new Date(now.getTime() - SESSION_TTL_MS) },
  });
  if (activeSession) {
    // Legacy sessions without phase are treated as already playing to avoid
    // unexpectedly launching a second ad for an older session.
    const phase = activeSession.phase ?? "playing";
    return {
      sessionId: activeSession.sessionId,
      resumed: phase === "playing",
      phase,
      crop: activeSession.crop,
      part: activeSession.part,
      target: activeSession.target ?? "field",
    };
  }

  if (player.lastAdAt && player.lastAdAt.getTime() + AD_COOLDOWN_MS > now.getTime()) {
    throw new Error("Please wait for the timer to finish");
  }
  const isContest = input.target === "contest";
  let round: number | undefined;
  if (isContest) {
    round = await currentGiveawayRound(db as never);
    const entry = await db.collection<{ _id: string }>("giveaway_entries").findOne({ _id: giveawayEntryId(round, tg.id) });
    if (!entry) throw new Error("Join the giveaway first");
  } else {
    const field = fieldParts(input.crop, player.fields?.[input.crop] as never)[input.part];
    if (!field?.planted) throw new Error("Plant a seed first");
    if (isReady(input.crop, field, now.getTime())) throw new Error("Already fully grown — tap to harvest");
  }
  const crop: CropKey = isContest ? "wheat" : input.crop;
  const part = isContest ? 0 : input.part;

  const sessionId = crypto.randomUUID().replace(/-/g, "");
  try {
    await sessions.updateOne(
      { _id: tg.id, status: { $ne: "pending" } },
      {
        $set: {
          sessionId,
          crop,
          part,
          target: isContest ? "contest" : "field",
          round,
          status: "pending",
          phase: "reserved",
          startedAt: undefined,
          createdAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      const racedSession = await sessions.findOne({
        _id: tg.id,
        status: "pending",
        expiresAt: { $gt: now },
        createdAt: { $gt: new Date(now.getTime() - SESSION_TTL_MS) },
      });
      if (racedSession) {
        const phase = racedSession.phase ?? "playing";
        return {
          sessionId: racedSession.sessionId,
          resumed: phase === "playing",
          phase,
          crop: racedSession.crop,
          part: racedSession.part,
          target: racedSession.target ?? "field",
        };
      }
    }
    throw error;
  }

  return { sessionId, resumed: false, phase: "reserved" as const, crop, part, target: isContest ? "contest" as const : "field" as const };
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
    { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: "client_playback_failed" } },
  );
  return { cancelled: true };
}

/** Mark a session as genuinely playing only after AdsGram reports onStart. */
export async function markAdSessionStarted(input: unknown) {
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
    { $set: { phase: "playing", startedAt: new Date() } },
  );
  return { started: true };
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
  if (session.status === "pending" && isSessionExpired(session, Date.now())) {
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
  if (!expectedSecret) {
    console.error("[adsgram] Reward callback rejected: ADSGRAM_REWARD_SECRET is not configured");
    return { status: 503, message: "Reward verification is not configured" };
  }
  if (!suppliedSecret || !safeSecretEqual(suppliedSecret, expectedSecret)) {
    console.warn("[adsgram] Reward callback rejected: secret mismatch");
    return { status: 403, message: "Invalid reward key" };
  }
  if (!userId || !/^\d{1,20}$/.test(userId)) {
    console.warn("[adsgram] Reward callback rejected: missing or invalid userid parameter");
    return { status: 400, message: "Invalid userid" };
  }
  const telegramId = Number(userId);
  if (!Number.isSafeInteger(telegramId)) {
    console.warn("[adsgram] Reward callback rejected: userid is not a safe integer");
    return { status: 400, message: "Invalid userid" };
  }

  const db = await getDb();
  const sessions = db.collection<AdSession>("ad_sessions");
  const session = await sessions.findOne({ _id: telegramId });
  if (!session) {
    console.warn("[adsgram] Reward callback rejected: no ad session for this user");
    return { status: 404, message: "No ad session" };
  }
  if (session.status === "verified") return { status: 200, message: "Already verified" };
  if (session.status !== "pending" || isSessionExpired(session, Date.now())) {
    console.warn(`[adsgram] Reward callback rejected: session is ${session.status} or expired`);
    return { status: 410, message: "No active ad session" };
  }

  const players = db.collection<Player>("players");
  for (let attempt = 0; attempt < 3; attempt++) {
    const player = await players.findOne({ _id: telegramId });
    if (!player) {
      console.warn("[adsgram] Reward callback rejected: player not found");
      return { status: 404, message: "Player not found" };
    }

    // A retry after the player update but before the session update must not award twice.
    if (player.lastAdSessionId === session.sessionId) {
      await sessions.updateOne(
        { _id: telegramId, sessionId: session.sessionId, status: "pending" },
        { $set: { status: "verified", verifiedAt: new Date() } },
      );
      console.info("[adsgram] Reward callback accepted");
      return { status: 200, message: "Verified" };
    }

    const now = Date.now();
    if (player.lastAdAt && player.lastAdAt.getTime() + AD_COOLDOWN_MS > now) {
      console.warn("[adsgram] Reward callback rejected: ad cooldown is active");
      return { status: 429, message: "Ad cooldown active" };
    }
    if (session.target === "contest") {
      const round = session.round ?? 0;
      const entry = await db.collection<{ _id: string }>("giveaway_entries").findOne({ _id: giveawayEntryId(round, telegramId) });
      if (!entry) {
        console.warn("[adsgram] Reward callback rejected: player is not in this giveaway round");
        return { status: 409, message: "Giveaway round is no longer open" };
      }
      const update = await players.updateOne(
        {
          _id: telegramId,
          lastAdAt: player.lastAdAt ?? { $exists: false },
          lastAdSessionId: player.lastAdSessionId ?? { $exists: false },
        } as never,
        { $set: { lastAdAt: new Date(now), lastAdSessionId: session.sessionId } },
      );
      if (!update.modifiedCount) continue;
      await addGiveawayPoint(db as never, round, telegramId);
      await sessions.updateOne(
        { _id: telegramId, sessionId: session.sessionId, status: "pending" },
        { $set: { status: "verified", verifiedAt: new Date(now) } },
      );
      console.info("[adsgram] Giveaway reward callback accepted");
      return { status: 200, message: "Verified" };
    }
    if (!CROP_KEYS.includes(session.crop) || !isFieldPart(session.crop, session.part)) {
      console.warn("[adsgram] Reward callback rejected: invalid crop or field part in session");
      return { status: 400, message: "Invalid ad session" };
    }

    const list = fieldParts(session.crop, player.fields?.[session.crop] as never);
    const field = list[session.part]!;
    if (!field.planted || isReady(session.crop, field, now)) {
      console.warn("[adsgram] Reward callback rejected: target field is not eligible");
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
    console.info("[adsgram] Reward callback accepted");
    return { status: 200, message: "Verified" };
  }
  console.warn("[adsgram] Reward callback could not update player after three attempts");
  return { status: 409, message: "Try again" };
}
