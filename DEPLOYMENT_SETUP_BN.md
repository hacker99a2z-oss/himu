# Telegram Mini App: GitHub, Render ও Vercel সেটআপ

এই repository-তে Telegram Mini App frontend এবং API/backend আলাদা:

- `frontend/` — Vercel-এ deploy হবে
- `backend/` — Render-এ deploy হবে
- `shared/` — frontend ও backend-এর common game rules/types

## কোন value secret

### Render-এর Environment Variables

পূর্ণ game, Telegram login, বিজ্ঞাপনের reward verification এবং payout চালাতে Render-এর Web Service-এ এই variables দিন:

| Variable | কী বসাবেন | Secret? |
| --- | --- | --- |
| `MONGODB_URI` | MongoDB-এর database connection URI | হ্যাঁ |
| `MONGODB_DB` | Database নাম; সাধারণত `farmcity` | না |
| `TELEGRAM_BOT_TOKEN` | BotFather থেকে পাওয়া bot token | হ্যাঁ |
| `TELEGRAM_WEBHOOK_SECRET` | নিজের তৈরি random secret | হ্যাঁ |
| `TONCENTER_API_KEY` | TON Center API key | হ্যাঁ |
| `TON_WALLET_MNEMONIC` | payout wallet-এর mnemonic/seed phrase | অত্যন্ত সংবেদনশীল |
| `TON_WALLET_VERSION` | Wallet version: `v5r1` অথবা `v4` | না |
| `ADSGRAM_REWARD_SECRET` | নিজের তৈরি random secret | হ্যাঁ |
| `PAYOUT_CRON_SECRET` | নিজের তৈরি আলাদা random secret | হ্যাঁ |
| `FRONTEND_URL` | Vercel app-এর exact origin, যেমন `https://your-app.vercel.app` | না |
| `WEBAPP_URL` | Telegram Mini App-এর URL; সাধারণত একই Vercel origin | না |

নিচেরগুলো optional; ব্যবহার করলে Render-এ দিন:

- `CHANNEL_URL`
- `SUPPORT_URL`
- `INTRO_VIDEO`
- `PAYMENTS_PROOF_URL`
- `CONTACT_SUPPORT_URL`
- `ALLOWED_ORIGINS` — একাধিক frontend origin হলে comma-separated origin

`FRONTEND_URL` ও `WEBAPP_URL`-এ শুধু origin দিন—শেষে `/` দেবেন না। `PORT` নিজে সেট করার দরকার নেই; Render এটি সরবরাহ করে।

### Secret নিরাপদে তৈরি ও রাখুন

নিজের কম্পিউটারের terminal-এ নিচের command **তিনবার আলাদা করে** চালান। প্রতিবারের আলাদা output যথাক্রমে `TELEGRAM_WEBHOOK_SECRET`, `ADSGRAM_REWARD_SECRET` এবং `PAYOUT_CRON_SECRET` হিসেবে ব্যবহার করুন:

```bash
openssl rand -hex 32
```

Output শুধু সংশ্লিষ্ট dashboard-এ paste করুন। Chat, source code, screenshot বা GitHub-এ দেবেন না। `TON_WALLET_MNEMONIC` seed phrase যাকে দেবেন সে wallet নিয়ন্ত্রণ করতে পারে—এটি শুধু Render-এর secret variable-এ রাখুন; Vercel-এ কখনো নয়।

## Deploy করার ক্রম

### ১. GitHub-এ project push করুন

পুরো project repository push করুন, আলাদা করে কয়েকটি source file নয়। নিচে GitHub তালিকাটি দেখুন। `.env`/secret value কখনো commit করবেন না।

### ২. Backend Render-এ deploy করুন

GitHub repository থেকে Render-এ একটি **Web Service** তৈরি করুন। `render.yaml` ব্যবহার করলে অধিকাংশ service settings আগে থেকেই আছে। হাতে সেট করলে:

- Root directory: `.`
- Build command: `npm ci && npm run build:backend`
- Start command: `npm run start:backend`
- Health check path: `/health`
- Node version: `20`

Render-এর **Environment**-এ উপরের required variables দিন। `FRONTEND_URL` ও `WEBAPP_URL` Vercel domain পাওয়ার পর বসানো যাবে। Deploy শেষে `https://YOUR-RENDER-SERVICE.onrender.com/health` খুলে `{"ok":true,...}` দেখা উচিত।

### ৩. Frontend Vercel-এ deploy করুন

একই GitHub repository Vercel-এ import করুন:

- Root directory: `.`
- Build command: `npm run build:frontend`
- Output directory: `frontend/dist`

Vercel-এর **Project Settings → Environment Variables**-এ শুধু এই public API address দিন:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | Render service origin, যেমন `https://YOUR-RENDER-SERVICE.onrender.com` |

`VITE_API_URL`-এর শেষে `/` দেবেন না। এটি secret নয়। Vercel-এ bot token, database URI, wallet mnemonic বা অন্য server secret রাখবেন না। Environment variable যোগ/বদলালে নতুন deployment করুন।

### ৪. দুই service-এর URL মিলিয়ে দিন

Vercel-এর final domain জানার পর Render-এ:

- `FRONTEND_URL` = Vercel origin, যেমন `https://your-app.vercel.app`
- `WEBAPP_URL` = Telegram Mini App-এর সেই একই Vercel origin

Render service আবার deploy করুন, যাতে CORS এবং TON Connect manifest নতুন URL নেয়।

### ৫. Telegram, AdsGram ও payout schedule যুক্ত করুন

- **Telegram Mini App:** BotFather-এ Mini App URL হিসেবে Vercel origin দিন।
- **Telegram webhook:** নিচের endpoint ব্যবহার করুন এবং `TELEGRAM_WEBHOOK_SECRET`-এর একই value webhook-এর `secret_token` হিসেবে দিন:

  ```text
  https://YOUR-RENDER-SERVICE.onrender.com/api/public/telegram
  ```

- **AdsGram Reward URL:** AdsGram publisher dashboard-এর rewarded ad unit-এ দিন। `key`-এর value Render-এর `ADSGRAM_REWARD_SECRET`-এর সঙ্গে হুবহু মিলতে হবে:

  ```text
  https://YOUR-RENDER-SERVICE.onrender.com/api/adsgram/reward?userid=[userId]&key=YOUR_ADSGRAM_REWARD_SECRET
  ```

- **Payout cron:** আপনার cron provider থেকে এই endpoint নির্দিষ্ট বিরতিতে call করুন। `key`-এর value Render-এর `PAYOUT_CRON_SECRET`-এর সঙ্গে মিলতে হবে:

  ```text
  https://YOUR-RENDER-SERVICE.onrender.com/api/public/payout?key=YOUR_PAYOUT_CRON_SECRET
  ```

বাস্তব TON payout চালুর আগে staging/test wallet দিয়ে যাচাই করুন। Payout wallet-এ শুধু প্রয়োজনীয় operating balance রাখুন।

## GitHub-এ কোন project files রাখবেন

সাধারণত পুরো repository-র tracked project files push করবেন—নির্দিষ্ট কয়েকটি file বেছে নয়। এই project-এর প্রয়োজনীয় অংশ:

- `frontend/`, `backend/`, `shared/`, `scripts/`, `patches/`
- `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`
- `render.yaml`, `vercel.json`, `.gitignore`
- `README.md`, `RENDER_SETUP.md`, `DEPLOYMENT_SETUP_BN.md`
- project-এর root config, যেমন `components.json`, `eslint.config.js`, `.prettierrc`

**কখনো GitHub-এ দেবেন না:**

- `.env`, `.env.production` বা অন্য environment file-এ থাকা secret value
- MongoDB URI, Telegram bot token, TON API key বা wallet mnemonic
- `node_modules/`, `frontend/dist/`, `backend/dist/`, build/cache output
- GitHub token, Vercel/Render token বা private key

`.gitignore` এখন `.env` এবং `.env.*`-কে ignore করে; placeholder-সহ `.env.example` রাখা অনুমোদিত। Secret আগে থেকেই GitHub-এ commit হয়ে থাকলে শুধু file মুছে দিলেই যথেষ্ট নয়—provider-এ secret rotate করুন।

## বর্তমান repository-তে push

বর্তমান `main` branch-এর app code `origin/main`-এর সঙ্গে synced। এই Bangla guide ও `.gitignore`-এর secret-ignore rule নতুন পরিবর্তন; GitHub-এ পাঠাতে project terminal-এ:

```bash
git add .gitignore DEPLOYMENT_SETUP_BN.md
git commit -m "Add Bengali deployment and secret setup guide"
git push origin main
```

পরে source/config বদলালে আগে `git status` দেখে শুধু প্রয়োজনীয় project files stage করুন, তারপর commit ও push করুন। `.env` stage করবেন না।
