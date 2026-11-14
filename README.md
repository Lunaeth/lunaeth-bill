# Lunaeth Bill

A self-hosted Canadian household bill-splitting app. Upload receipts or enter items, choose who shares each item, confirm selections, and see the final settlement.

## Features

- Simplified Chinese, Traditional Chinese and Canadian English. The language menu displays **简中 / 繁中 / English**.
- Receipt images and PDFs, background AI recognition, upload progress, manual item entry, receipt reconciliation and six-character share links.
- Google Gemini, Anthropic Claude, OpenAI, Grok, Meta Muse, DeepSeek and Qwen adapters with ready-to-use model defaults. Qwen supports international, mainland China and US API regions.
- An administrator settings panel for the site name, provider, write-only API keys, default tax rate, member profiles, E-Transfer addresses, invitations and PIN reset links.
- Standard combined sales-tax presets for all 13 Canadian provinces and territories, plus custom rates with three decimal places.
- Changing the site-wide default tax rate reprices taxable items in unfinished active bills. Bills with changed amounts return to draft and require fresh confirmations. Printed receipt totals stay intact for review. Finalized bills retain their stored amounts.
- Integer-cent accounting with exact fractional shares accumulated per person, then rounded to the nearest cent. Share totals may differ from the printed receipt total.
- Creators manage their own bills; administrators manage all bills. Only the creator selects the payment recipient. Share links require sign-in and bill membership.

## Run locally

Requires Node.js 24 or later and pnpm. On Linux, native canvas binaries need a supported platform; the standard x64 glibc build is supported.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
cp .env.example .env
pnpm start
```

Open `http://127.0.0.1:3088`. Read the one-time setup token from `data/setup-token` and create your own administrator username, name and four-digit PIN. The six generic member placeholders are not real accounts; edit or disable them and add your own members in settings.

For development, run `pnpm server` and `pnpm dev` in separate terminals with the appropriate environment. The Vite proxy targets port 3088.

## AI setup

Open **Settings → Website and AI**, choose a provider, enter its key, optionally run **Test connection and recognition**, and save. The test sends a generated fictional receipt and incurs a small provider charge. Model access, quota and regional API-key restrictions are controlled by each provider. Advanced settings allow a model override without allowing arbitrary API endpoints.

Keys are AES-256-GCM encrypted in SQLite. The separate `DATA_DIR/settings.key` file must be included in private backups. APIs return only whether a key is configured; they never return the key itself. Environment-provided keys remain supported as a fallback until explicitly replaced or removed in the administrator panel.

PDF pages are rendered locally for image-only APIs. Original receipts remain in the private SQLite store. Costco name lookup uses provider search when available (Gemini/OpenAI); other adapters preserve the model's translation and uncertain original labels.

## Deployment and backup

Build on a supported Node.js host, run the service behind an HTTPS reverse proxy, set `NODE_ENV=production`, and set `APP_ORIGIN` to the exact public origin. Set `TRUST_PROXY=1` only when the trusted proxy overwrites forwarded client headers. Keep `DATA_DIR` outside the application release and outside all web roots. The server can listen on `SOCKET_PATH` instead of a TCP port.

Back up SQLite using its backup API, together with `settings.key`, into a directory readable only by the service administrator. Restoring the database without its matching encryption key cannot restore saved API credentials. Do not place backups, receipts, reset tokens, credentials or generated exports in this repository.

## Tests and privacy

```sh
pnpm test
pnpm build
pnpm privacy:check
```

All committed test data is synthetic. This repository contains no production database, receipt, member roster, personal contact address, credential, screenshot or historical bill fixture. Production deployments do not import or seed the test data. See [API and tax references](docs/references.md).
