# Local Ｚiraat Baank Site

A local English-language reproduction of the public Ｚiraat Baank homepage, captured on September 3, 2026. It includes the original public HTML, images, fonts, and downloaded styles, plus a clearly labeled simulated banking environment.

## Run locally

Node.js 22.8 or newer is required.

```sh
npm start
```

Open http://localhost:3000/. The customer banking dashboard is available at http://localhost:3000/internet-banking and the operations dashboard at http://localhost:3000/operator. The legacy `/operador` route remains available for compatibility.

The operator dashboard is protected by `OPERATOR_KEY`. Initial customer credentials are configured with `BANK_CUSTOMER_USER` and `BANK_CUSTOMER_PASSWORD`. Copy `.env.example` into your environment before deployment; Node does not load `.env` automatically.

```sh
npm run build
npm test
```

## Project structure

- `public/`: static application and local assets.
- `server.mjs`: HTTP server and chat/banking APIs.
- `chat-store.mjs`: visitor support-chat persistence.
- `bank-store.mjs`: accounts, balances, transaction ledger, and customer messages.
- `recursos/`: preserved source pages and asset manifests.
- `Dockerfile` and `railway.json`: Railway-compatible deployment configuration.
- `tests/`: HTTP, asset, calculation, authentication, and banking-flow tests.

## Banking portal

The customer can review their balance and history, make simulated deposits and withdrawals, and exchange messages with the operator. The operator can create and deactivate customer accounts, inspect customer activity, see withdrawals, apply credits or debits, and reply to customer messages. Passwords are stored only as salted hashes. Deactivation blocks access while preserving the transaction history for audit purposes.

All transactions are simulated. The application does not connect to payment networks or move real money. The interface warns users not to enter real credentials.

When `DATABASE_URL` is available, balances and messages are persisted in PostgreSQL and balance updates run inside database transactions. Without PostgreSQL, the application uses temporary in-memory storage that resets when the server restarts.

## Railway and PostgreSQL

1. Add PostgreSQL to the Railway project and link it to the web service.
2. Configure long, private values for `OPERATOR_KEY`, `BANK_CUSTOMER_PASSWORD`, and `BANK_SESSION_SECRET`.
3. Keep `DATABASE_SSL=true` for Railway.
4. Deploy normally. Startup creates the chat, customer, transaction, and message tables idempotently without deleting existing data.

## Cloudflare R2 chat images

The public-site and authenticated banking chats accept JPG, PNG, WEBP, and GIF images up to 5 MB, plus PDF, TXT, CSV, DOCX, and XLSX documents up to 10 MB. Visitors and banking customers can choose, paste, or drag attachments into the chat; operators can view and send them in either conversation type. The server validates the extension, declared MIME type, file signature, and size before upload. Executables and unlisted formats are rejected, and documents are served as downloads.

Create an R2 API token with object read/write access to the selected bucket, enable public access through an `r2.dev` URL or a custom domain, and configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET_NAME`, and `R2_PUBLIC_URL`. The server uploads image bytes to R2 and stores only the public URL and message metadata in PostgreSQL.

## Public-site content

The `/` homepage includes the carousel, keyboard and touch controls, menus, local search, calculators, footer destinations, cookie notice, and support chat. Product and information routes are generated from the preserved public English pages in `recursos/pages`.

Exchange rates are a reference snapshot and are not live. Calculators are mathematical demonstrations and do not represent a banking offer.

## Refreshing public assets

```sh
python scripts/prepare-assets.py
curl --parallel --parallel-max 6 --fail --location --config recursos/download-assets.conf
curl --parallel --parallel-max 6 --fail --location --config recursos/download-menu-pages.conf
curl --parallel --parallel-max 6 --fail --location --config recursos/download-footer-pages.conf
curl --parallel --parallel-max 3 --fail --location --config recursos/download-hero-pages.conf
npm run prepare:menu-assets
curl --parallel --parallel-max 6 --fail --location --config recursos/download-menu-assets.conf
npm run build
```

The included assets are sufficient to run the current reproduction without downloading anything else.
