import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cancelAdSession, getAdSessionStatus, startAdSession, verifyAdsgramReward } from "./ad-sessions.js";
import { runPayouts } from "./payout.js";
import {
  claimDaily,
  confirmSeedOrder,
  createSeedOrder,
  createUnlockOrder,
  enterContest,
  loadContest,
  getGramQuote,
  loadPlayer,
  sellCrops,
  tapField,
  withdraw,
} from "./player.functions.js";
import { handleTelegramUpdate } from "./telegram-webhook.js";
import { publicWithdrawalUrl } from "./withdrawal-links.js";

const MAX_BODY_BYTES = 64 * 1024;
const localOrigins = new Set(["http://localhost:5000", "http://127.0.0.1:5000"]);

function allowedOrigins() {
  const configured = [process.env["FRONTEND_URL"], process.env["ALLOWED_ORIGINS"]]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const origins = new Set(configured.map((item) => {
    try {
      return new URL(item).origin;
    } catch {
      return item;
    }
  }));
  if (process.env["NODE_ENV"] !== "production") {
    for (const origin of localOrigins) origins.add(origin);
  }
  return origins;
}

function cors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  response.setHeader("Vary", "Origin");
  if (request.url?.split("?")[0] === "/tonconnect-manifest.json") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return true;
  }
  if (!origin) return true;
  if (!allowedOrigins().has(origin)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Bot-Api-Secret-Token");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(message);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const explicitStatus = error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 0;
  if (explicitStatus >= 400 && explicitStatus < 500) return { status: explicitStatus, error: message };
  if (/^Mongo/.test(error instanceof Error ? error.name : "")) {
    console.error("Database request failed", error);
    return { status: 503, error: "The game database is temporarily unavailable" };
  }
  if (message === "Bot token missing" || message === "Telegram bot is not configured") {
    return { status: 503, error: "Telegram authentication is not configured" };
  }
  if (message === "Invalid login" || message === "Login expired, reopen the game" ||
      message === "Open the game inside Telegram") {
    return { status: 401, error: message };
  }
  if (error instanceof Error && error.constructor === Error) return { status: 400, error: message || "Invalid request" };
  console.error("Unhandled API error", error);
  return { status: 500, error: "Internal server error" };
}

async function route(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "farm-city-api" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/tonconnect-manifest.json") {
    const appUrl = process.env["WEBAPP_URL"] ?? process.env["FRONTEND_URL"] ?? url.origin;
    sendJson(response, 200, {
      url: appUrl,
      name: "Farm City",
      iconUrl: `${appUrl.replace(/\/+$/, "")}/favicon.ico`,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/withdrawal-links") {
    sendJson(response, 200, {
      paymentsProof: publicWithdrawalUrl(process.env["PAYMENTS_PROOF_URL"]),
      contactSupport: publicWithdrawalUrl(process.env["CONTACT_SUPPORT_URL"]),
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/ton/quote") {
    sendJson(response, 200, await getGramQuote());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/adsgram/reward") {
    const result = await verifyAdsgramReward(url.searchParams.get("userid"), url.searchParams.get("key"));
    sendText(response, result.status, result.message);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/public/payout") {
    const secret = process.env["PAYOUT_CRON_SECRET"];
    if (!secret || url.searchParams.get("key") !== secret) {
      sendText(response, 200, "ok");
      return;
    }
    sendJson(response, 200, await runPayouts());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/public/telegram") {
    const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
    if (!secret || String(request.headers["x-telegram-bot-api-secret-token"] ?? "") !== secret) {
      sendText(response, 403, "forbidden");
      return;
    }
    const update = await readJson(request);
    await handleTelegramUpdate(update, process.env["WEBAPP_URL"] ?? url.origin);
    sendText(response, 200, "ok");
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const data = await readJson(request);
  const handlers: Record<string, () => Promise<unknown>> = {
    "/api/player/load": () => loadPlayer({ data } as never),
    "/api/player/tap": () => tapField({ data } as never),
    "/api/player/daily": () => claimDaily({ data } as never),
    "/api/player/sell": () => sellCrops({ data } as never),
    "/api/withdrawals": () => withdraw({ data } as never),
    "/api/orders": () => createSeedOrder({ data } as never),
    "/api/unlock": () => createUnlockOrder({ data } as never),
    "/api/contest/load": () => loadContest({ data } as never),
    "/api/contest/enter": () => enterContest({ data } as never),
    "/api/orders/confirm": () => confirmSeedOrder({ data } as never),
    "/api/ads/session/start": () => startAdSession(data),
    "/api/ads/session/status": () => getAdSessionStatus(data),
    "/api/ads/session/cancel": () => cancelAdSession(data),
  };
  const handler = handlers[url.pathname];
  if (!handler) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  sendJson(response, 200, await handler());
}

const server = createServer(async (request, response) => {
  if (!cors(request, response)) {
    sendJson(response, 403, { error: "Origin is not allowed" });
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    await route(request, response, url);
  } catch (error) {
    const result = errorResponse(error);
    sendJson(response, result.status, { error: result.error });
  }
});

const port = Number(process.env["PORT"] ?? process.env["API_PORT"] ?? 3001);
const host = process.env["HOST"] ?? "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Farm City API listening on ${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
