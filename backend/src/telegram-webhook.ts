import { getDb } from "./db.js";

const CAPTION = [
  "🌾 <b>Welcome to Farm City!</b>",
  "",
  "🌱 Plant seeds  •  ⏳ Grow them  •  🌽 Harvest crops",
  "💰 Sell crops for real balance",
  "👥 Invite friends & earn 10% of their purchases",
  "⚡ Withdraw to your TON wallet — auto payout!",
  "",
  "👇 Tap <b>Play Now</b> to start farming",
].join("\n");

async function telegram(method: string, body: unknown) {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) throw new Error("Telegram bot is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<{ ok: boolean; description?: string }>;
}

export async function handleTelegramUpdate(update: unknown, requestOrigin: string) {
  const message = (update as {
    message?: { chat?: { id?: number }; from?: { id?: number }; text?: string };
  } | null)?.message;
  if (!message?.text?.startsWith("/start") || !message.chat?.id) return;

  const appUrl = process.env["WEBAPP_URL"] ?? process.env["FRONTEND_URL"] ?? requestOrigin;
  const payload = message.text.split(" ")[1];
  const ref = payload?.match(/^ref_(\d+)$/);
  if (ref && message.from?.id && Number(ref[1]) !== message.from.id) {
    try {
      const db = await getDb();
      await db.collection<{ _id: number; ref: number; at: Date }>("start_refs").updateOne(
        { _id: message.from.id },
        { $setOnInsert: { ref: Number(ref[1]), at: new Date() } },
        { upsert: true },
      );
    } catch (error) {
      console.error("Unable to save Telegram referral start parameter", error);
    }
  }

  const rows: { text: string; web_app?: { url: string }; url?: string }[][] = [
    [{ text: "🎮 Play Now", web_app: { url: appUrl } }],
  ];
  if (process.env["CHANNEL_URL"]) rows.push([{ text: "📢 Official Channel", url: process.env["CHANNEL_URL"] }]);
  if (process.env["SUPPORT_URL"]) rows.push([{ text: "💬 Support Group", url: process.env["SUPPORT_URL"] }]);
  const replyMarkup = { inline_keyboard: rows };
  const base = { chat_id: message.chat.id, caption: CAPTION, parse_mode: "HTML", reply_markup: replyMarkup };

  const video = process.env["INTRO_VIDEO"];
  const response = video
    ? await telegram("sendVideo", { ...base, video, supports_streaming: true })
    : { ok: false };
  if (!response.ok) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: CAPTION,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }
}
