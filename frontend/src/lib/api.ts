import type { CropKey, PlayerView } from "@shared/rules";

export const apiOrigin = (import.meta.env["VITE_API_URL"] ?? "").replace(/\/+$/, "");

async function request<T>(path: string, body?: unknown): Promise<T> {
  if (!apiOrigin && !import.meta.env.DEV) {
    throw new Error("The API URL is not configured. Set VITE_API_URL to the Render API origin.");
  }
  const options: RequestInit =
    body === undefined
      ? { method: "GET" }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(`${apiOrigin}${path}`, options);
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "The server could not complete this request");
  }
  return payload as T;
}

export const gameApi = {
  loadPlayer: (initData: string) => request<PlayerView>("/api/player/load", { initData }),
  tapField: (initData: string, crop: CropKey, part: number) =>
    request<{ ok: boolean; message: string; player: PlayerView }>("/api/player/tap", { initData, crop, part }),
  claimDaily: (initData: string) =>
    request<{ day: number; crop: CropKey; player: PlayerView }>("/api/player/daily", { initData }),
  sellCrops: (initData: string, crop: CropKey, qty: number) =>
    request<{ earnedCents: number; player: PlayerView }>("/api/player/sell", { initData, crop, qty }),
  withdraw: (initData: string, cents: number, address: string) =>
    request<{ player: PlayerView }>("/api/withdrawals", { initData, cents, address }),
  gramQuote: () => request<{ tonUsd: number; nanoPerDollar: string }>("/api/ton/quote"),
  createSeedOrder: (initData: string, crop: CropKey, qty: number) =>
    request<{ orderId: string; address: string; nano: string; comment: string }>("/api/orders", { initData, crop, qty }),
  confirmSeedOrder: (initData: string, orderId: string) =>
    request<{ paid: boolean; player: PlayerView | null }>("/api/orders/confirm", { initData, orderId }),
  withdrawalLinks: () =>
    request<{ paymentsProof: string | null; contactSupport: string | null }>("/api/withdrawal-links"),
  startAdSession: (initData: string, crop: CropKey, part: number) =>
    request<{ sessionId: string }>("/api/ads/session/start", { initData, crop, part }),
  getAdSessionStatus: (initData: string, sessionId: string) =>
    request<{ verified: boolean; expired: boolean; player: PlayerView | null }>("/api/ads/session/status", {
      initData,
      sessionId,
    }),
  cancelAdSession: (initData: string, sessionId: string) =>
    request<{ cancelled: boolean }>("/api/ads/session/cancel", { initData, sessionId }),
};
