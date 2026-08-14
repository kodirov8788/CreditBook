# CreditBook

CreditBook is a mobile-first digital credit ledger for small shops. It tracks customers, credit entries, partial payments, balances, due dates, and payment history.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth and PostgreSQL
- Vercel deployment
- Plain CSS with a responsive UI foundation

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add the Supabase URL and publishable key to `.env.local`. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor before using live data.

## Security

Row Level Security is enabled for every application table. The browser only uses the public Supabase publishable key. Never commit a secret key, database password, or service-role credential. Add production environment variables in Vercel's project settings.

## Deployment

Import the GitHub repository into Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then deploy. Configure the Supabase Auth Site URL and redirect URL to the Vercel domain.
