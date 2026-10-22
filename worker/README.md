# Clipper live data — setup

A small Cloudflare Worker (`clipper-live.js`) holds your API keys, checks your
YouTube channels and posted Shorts every hour, and hands the numbers to the
Clipper app. Everything below is free and done in the browser — no installs.

## 1. Get a YouTube API key (Google Cloud)

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Clipper").
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key → **API restrictions → Restrict key → YouTube Data API v3** → Save.
   (Leave *Application restrictions* as None — the worker calls YouTube from Cloudflare, not your browser.)
5. Copy the key.

The free quota is 10,000 units a day; an hourly check of a few channels uses well under 500.

## 2. Create the Worker (Cloudflare)

1. Sign up at <https://dash.cloudflare.com/> (free plan).
2. **Workers & Pages → Create → Create Worker** → name it `clipper-live` → **Deploy**.
3. **Edit code** → delete the sample → paste the whole of `clipper-live.js` → **Deploy**.
4. Note the URL it shows, like `https://clipper-live.<your-subdomain>.workers.dev`.

## 3. Give it storage

1. **Storage & Databases → KV → Create** → name it `clipper-stats`.
2. Back on the worker: **Settings → Bindings → Add → KV namespace**
   - Variable name: `STATS`
   - KV namespace: `clipper-stats`

## 4. Add the keys

Worker → **Settings → Variables and Secrets → Add**:

| Type   | Name              | Value |
|--------|-------------------|-------|
| Secret | `YT_API_KEY`      | the key from step 1 |
| Secret | `APP_TOKEN`       | any long random password you make up — the app sends it to prove it's you |
| Text   | `ALLOWED_ORIGINS` | `https://ivanbyer-design.github.io,http://localhost:8765` |

Deploy again if the dashboard asks.

## 5. Run it every hour

Worker → **Settings → Triggers → Cron Triggers → Add** → `0 * * * *` (every hour, on the hour).

## 6. Connect the app

Clipper → **Settings → Live data**: paste the worker URL and your `APP_TOKEN` → **Connect**.

The app sends the worker your YouTube accounts (by handle) and the YouTube links
of posted clips. From then on:

- YouTube accounts show a green **Live** badge, and follower counts fill the growth graphs on their own.
- Posted Shorts get their view counts automatically (48h / 7-day numbers fill in when they're due).
- The "Update followers" to-do stops appearing for live accounts.

## Troubleshooting

The status and any error show under **Settings → Live data**.

- **wrong access token** — the token in the app doesn't match `APP_TOKEN`.
- **Could not reach the worker** — check the URL, and that `ALLOWED_ORIGINS` lists the exact site you're using.
- **no YouTube channel with that handle** — the account's handle in Clipper must match the channel's @handle.
- **STATS KV namespace is not bound** — redo step 3 (variable name must be `STATS`).
