# Replit run instructions

- Run the split frontend and API together with `npm run dev`.
- The Vite mini app preview uses port 5000; its local `/api` requests are proxied to the Node API on port 3001.
- Frontend files are in `frontend/`, server-only logic is in `backend/`, and browser/server game rules are shared from `shared/`.
- Game actions need `MONGODB_URI` and `TELEGRAM_BOT_TOKEN`. TON ordering and payouts also need the corresponding TON credentials. AdsGram rewards need `ADSGRAM_REWARD_SECRET` and the callback URL configured in the AdsGram publisher dashboard.
- See `RENDER_SETUP.md` for Vercel, Render, Telegram webhook, and AdsGram setup.
