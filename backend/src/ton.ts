import { Address } from "@ton/core";

export const MERCHANT_ADDRESS = "UQBGUz_gEQHLm2NRt9D8Y6ZWh9b-20-EgNZxDNdrzQryX_AX";
const TONCENTER = "https://toncenter.com/api/v2";

const apiHeaders = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return key ? { "X-API-Key": key } : {};
};

/** Convert a user-friendly or raw address to its canonical raw form. */
export function toRawAddress(address: string): string {
  return Address.parse(address).toRawString();
}

function sameAddress(a: string | undefined, b: string): boolean {
  if (!a) return false;
  try {
    return toRawAddress(a) === toRawAddress(b);
  } catch {
    return false;
  }
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

type TxMessage = {
  hash?: string;
  value?: string;
  message?: string;
  source?: string;
  destination?: string;
  message_decode_error?: string;
};
type Tx = {
  hash?: string;
  transaction_id?: { hash?: string; lt?: string };
  in_msg?: TxMessage;
};
type TxResponse = { ok?: boolean; result?: Tx[]; error?: string };

async function getTransactions(limit: number): Promise<Tx[]> {
  const query = new URLSearchParams({
    address: MERCHANT_ADDRESS,
    limit: String(limit),
    archival: "true",
  });
  const r = await fetch(TONCENTER + "/getTransactions?" + query.toString(), { headers: apiHeaders() });
  if (!r.ok) {
    console.error("Toncenter fetch failed:", r.status, r.statusText);
    return [];
  }
  const j = (await r.json()) as TxResponse;
  if (j.ok !== true || !Array.isArray(j.result)) {
    console.error("Toncenter transaction response invalid:", j.error ?? "missing result");
    return [];
  }
  return j.result;
}

function transactionHash(tx: Tx): string | null {
  return tx.transaction_id?.hash ?? tx.hash ?? null;
}

function matchesPayment(tx: Tx, comment: string, minNano: bigint): boolean {
  const msg = tx.in_msg;
  if (!msg || msg.message !== comment || !sameAddress(msg.destination, MERCHANT_ADDRESS)) return false;
  try {
    return BigInt(msg.value || "0") >= minNano;
  } catch {
    return false;
  }
}

/** Finds an incoming payment to the merchant wallet with this comment and at least minNano. */
export async function findPayment(comment: string, minNano: bigint): Promise<string | null> {
  try {
    const transactions = await getTransactions(200);
    // Allow 2% slippage tolerance for wallet rounding.
    const min = (minNano * 98n) / 100n;
    const tx = transactions.find((t) => matchesPayment(t, comment, min));
    const hash = tx ? transactionHash(tx) : null;
    if (tx && hash) {
      console.log("Payment found:", hash, "comment:", comment, "value:", tx.in_msg?.value);
    } else {
      console.log("Payment not found for comment:", comment, "searched", transactions.length, "transactions");
    }
    return hash;
  } catch (e) {
    console.error("Error finding payment:", e);
    return null;
  }
}

/** Debug: Returns recent transactions from the merchant wallet. */
export async function getRecentTransactions(): Promise<Tx[]> {
  return getTransactions(20);
}

/** Check whether a transaction hash matches the expected payment on the merchant wallet. */
export async function verifyTransaction(txHash: string, expectedComment: string, minNano: bigint): Promise<boolean> {
  try {
    const transactions = await getTransactions(200);
    const normalizeHash = (value: string | undefined) => (value ?? "").replace(/^0x/i, "").toLowerCase();
    const tx = transactions.find((t) => normalizeHash(transactionHash(t) ?? undefined) === normalizeHash(txHash));
    if (!tx || !matchesPayment(tx, expectedComment, minNano)) return false;
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
