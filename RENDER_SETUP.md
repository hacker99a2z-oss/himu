# Farm City deployment

The repository is split into a static Telegram Mini App in `frontend/` and a Node API in `backend/`.

## Deploy the API to Render

Create a Render Web Service from this repository and use:

- Root directory: `.`
- Build command: `npm ci && npm run build:backend`
- Start command: `npm run start:backend`
- Health check path: `/health`

Set these environment variables in Render:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name; defaults to `farmcity` |
| `TELEGRAM_BOT_TOKEN` | Verifies Telegram Mini App `initData` and sends bot messages |
| `TELEGRAM_WEBHOOK_SECRET` | Verifies Telegram webhook requests |
| `FRONTEND_URL` | Exact Vercel site origin, such as `https://your-app.vercel.app`; used for CORS and the TON Connect manifest |
| `WEBAPP_URL` | Telegram bot's Mini App URL; normally the same Vercel URL |
| `TONCENTER_API_KEY` | TON transaction lookup and payout API |
| `TON_WALLET_MNEMONIC` | Server-only payout wallet mnemonic |
| `TON_WALLET_VERSION` | `v5r1` or `v4` |
| `ADSGRAM_REWARD_SECRET` | Random secret used only in the AdsGram reward callback URL |
| `PAYOUT_CRON_SECRET` | Protects the payout worker endpoint |

Optional public settings: `CHANNEL_URL`, `SUPPORT_URL`, `INTRO_VIDEO`, `PAYMENTS_PROOF_URL`, and `CONTACT_SUPPORT_URL`.

Never set `TON_WALLET_MNEMONIC`, `TELEGRAM_BOT_TOKEN`, or `ADSGRAM_REWARD_SECRET` in Vercel or any `VITE_*` variable.

## Deploy the frontend to Vercel

Import the same repository into Vercel and set:

- Root directory: `.`
- Build command: `npm run build:frontend`
- Output directory: `frontend/dist`

Add the environment variable `VITE_API_URL` with the Render service's HTTPS origin (no trailing slash), for example `https://farm-city-api.onrender.com`. The included `vercel.json` contains the static build and SPA route fallback.

After deployment, add that exact Vercel origin to Render's `FRONTEND_URL` and `WEBAPP_URL`, then redeploy the API.

## Configure Telegram and AdsGram

Set the Telegram bot's Mini App URL to the Vercel URL. Point the Telegram webhook at:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/public/telegram
```

Register it with Telegram's `setWebhook` method and pass the same `TELEGRAM_WEBHOOK_SECRET` as `secret_token`.

In the AdsGram publisher dashboard, set the rewarded ad unit's **Reward URL** to:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/adsgram/reward?userid=[userId]&key=YOUR_ADSGRAM_REWARD_SECRET
```

Use the exact same URL-safe random value for the Render `ADSGRAM_REWARD_SECRET` variable and the URL's `key`. Keep the AdsGram `[userId]` placeholder exactly as shown; AdsGram replaces it with the Telegram user ID. The URL must be the public HTTPS Render URL, and the Reward URL must be saved on the rewarded ad unit used by block `41655`.

The frontend never grants ad progress. It only starts an authenticated session and checks its status; the backend updates MongoDB only after the secret-protected AdsGram callback succeeds. A dashboard impression does not by itself prove that the Reward URL callback succeeded. In Render logs, `[adsgram] Reward callback accepted` means it did; a rejection log gives a safe reason such as a missing server secret, incorrect key, missing `userid`, expired session, or ineligible field. Never put the secret in the frontend or a `VITE_*` variable.

AdsGram does not send the callback in SDK debug mode. Also, its `show()` promise rejects when playback fails or no ad is available; the app now cancels that unfinished session so it does not remain stuck as pending.

Configure your cron service to request:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET
```

The payout worker needs TON in the wallet corresponding to `TON_WALLET_MNEMONIC`.

## Local development

Install dependencies with `npm ci`, then run `npm run dev`. The frontend is on port 5000 and proxies `/api` plus the TON Connect manifest to the local API on port 3001. MongoDB and Telegram settings are required for game actions; without them, only the app shell and API health endpoint can be checked.
