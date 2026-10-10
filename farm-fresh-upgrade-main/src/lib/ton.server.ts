import { Address, internal, toNano, beginCell, SendMode } from "@ton/core";
import { TonClient, WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

export const MERCHANT_ADDRESS = "UQBGUz_gEQHLm2NRt9D8Y6ZWh9b-20-EgNZxDNdrzQryX_AX";
const TONCENTER = "https://toncenter.com/api/v2";

const apiHeaders = (): Record<string, string> => {
  const key = process.env["TONCENTER_API_KEY"];
  return key ? { "X-API-Key": key } : {};
};

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

type Tx = { transaction_id: { hash: string }; in_msg?: { value: string; message?: string; source?: string } };

/** Finds an incoming payment to the merchant wallet with this comment and at least `minNano`. */
export async function findPayment(comment: string, minNano: bigint): Promise<string | null> {
  const r = await fetch(`${TONCENTER}/getTransactions?address=${MERCHANT_ADDRESS}&limit=50&archival=true`, { headers: apiHeaders() });
  if (!r.ok) return null;
  const j = (await r.json()) as { ok: boolean; result: Tx[] };
  // allow 2% slippage tolerance for wallet rounding
  const min = (minNano * 98n) / 100n;
  const tx = j.result?.find((t) => t.in_msg?.message === comment && BigInt(t.in_msg.value || "0") >= min);
  return tx ? tx.transaction_id.hash : null;
}

export function normalizeAddress(raw: string): string {
  return Address.parse(raw).toString({ bounceable: false });
}

/** Sends Gram (TON) from the payout wallet. */
export async function sendTon(to: string, nano: bigint, memo: string) {
  const words = process.env["TON_WALLET_MNEMONIC"];
  if (!words) throw new Error("Withdrawals are not configured yet");
  const key = await mnemonicToPrivateKey(words.trim().split(/\s+/));
  const wallet =
    (process.env["TON_WALLET_VERSION"] ?? "v5r1").toLowerCase() === "v4"
      ? WalletContractV4.create({ workchain: 0, publicKey: key.publicKey })
      : WalletContractV5R1.create({ publicKey: key.publicKey });
  const client = new TonClient({ endpoint: `${TONCENTER}/jsonRPC`, ...(process.env["TONCENTER_API_KEY"] ? { apiKey: process.env["TONCENTER_API_KEY"] } : {}) });
  const contract = client.open(wallet);
  const balance = await contract.getBalance();
  if (balance < nano + toNano("0.01")) throw new Error("Payout wallet is low on funds, try later");
  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    seqno,
    secretKey: key.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [internal({ to: Address.parse(to), value: nano, bounce: false, body: beginCell().storeUint(0, 32).storeStringTail(memo).endCell() })],
  });
}
