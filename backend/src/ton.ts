import { Address } from "@ton/core";

export const MERCHANT_ADDRESS = "UQBGUz_gEQHLm2NRt9D8Y6ZWh9b-20-EgNZxDNdrzQryX_AX";
const TONAPI = "https://tonapi.io/v2";

const apiHeaders = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return key ? { "Authorization": `Bearer ${key}` } : {};
};

/** Convert user-friendly address to raw format for API calls. */
export function toRawAddress(userFriendly: string): string {
  return Address.parse(userFriendly).toString({ bounceable: false });
}

/** Live price of 1 Gram (TON) in USD. */
export async function getTonUsd(): Promise<number> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
  if (r.ok) {
    const j = (await r.json()) as { "the-open-network"?: { usd?: number } };
    const p = j["the-open-network"]?.usd;
    if (p && p > 0) return p;
  }
  const r2 = await fetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd");
  const j2 = (await r2.json()) as { rates?: { TON?: { prices?: { USD?: number } } } };
  const p2 = j2.rates?.TON?.prices?.USD;
  if (!p2) throw new Error("Price unavailable, try again");
  return p2;
}

type Tx = { hash: string; in_msg?: { value: string; message?: string; source?: string } };

/** Finds an incoming payment to the merchant wallet with this comment and at least `minNano`. */
export async function findPayment(comment: string, minNano: bigint): Promise<string | null> {
  try {
    const r = await fetch(`${TONAPI}/blockchain/accounts/${MERCHANT_ADDRESS}/transactions?limit=200`, { headers: apiHeaders() });
    if (!r.ok) {
      console.error("Tonapi fetch failed:", r.status, r.statusText);
      return null;
    }
    const j = (await r.json()) as { transactions?: Tx[] };
    // allow 2% slippage tolerance for wallet rounding
    const min = (minNano * 98n) / 100n;
    const tx = j.transactions?.find((t) => t.in_msg?.message === comment && BigInt(t.in_msg.value || "0") >= min);
    if (tx) {
      console.log("Payment found:", tx.hash, "comment:", comment, "value:", tx.in_msg?.value);
    } else {
      console.log("Payment not found for comment:", comment, "searched", j.transactions?.length, "transactions");
    }
    return tx ? tx.hash : null;
  } catch (e) {
    console.error("Error finding payment:", e);
    return null;
  }
}

/** Debug: Returns recent transactions from merchant wallet. */
export async function getRecentTransactions(): Promise<Tx[]> {
  const r = await fetch(`${TONAPI}/blockchain/accounts/${MERCHANT_ADDRESS}/transactions?limit=20`, { headers: apiHeaders() });
  if (!r.ok) return [];
  const j = (await r.json()) as { transactions?: Tx[] };
  return j.transactions ?? [];
}

/** Check if a specific transaction hash exists and matches the expected criteria. */
export async function verifyTransaction(txHash: string, expectedComment: string, minNano: bigint): Promise<boolean> {
  try {
    const r = await fetch(`${TONAPI}/blockchain/transactions/${txHash}`, { headers: apiHeaders() });
    if (!r.ok) return false;
    const j = await r.json() as { in_msg?: { value: string; message?: string; destination?: { address: string } } };
    const msg = j.in_msg;
    if (!msg) return false;
    const rawAddress = toRawAddress(MERCHANT_ADDRESS);
    if (msg.destination?.address !== rawAddress) return false;
    if (msg.message !== expectedComment) return false;
    if (BigInt(msg.value || "0") < minNano) return false;
    console.log("Transaction verified:", txHash);
    return true;
  } catch (e) {
    console.error("Error verifying transaction:", e);
    return false;
  }
}

export function normalizeAddress(raw: string): string {
  return Address.parse(raw).toString({ bounceable: false });
}
