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

For an existing database, apply the files in [`supabase/migrations`](./supabase/migrations) after the base schema. Review and test each migration before applying it to production.

After applying the RBAC migrations, assign the first platform owner explicitly in Supabase SQL Editor:

```sql
insert into public.platform_roles (user_id, role)
select id, 'platform_owner'
from auth.users
where email = 'your-owner-email@example.com'
on conflict (user_id) do update set role = excluded.role;
```

Do not make the first signed-in user an owner automatically. Keep the platform owner account protected with MFA and use `/admin` only after this role is assigned.

## Security

Row Level Security is enabled for every application table. The browser only uses the public Supabase publishable key. Never commit a secret key, database password, or service-role credential. Add production environment variables in Vercel's project settings.

## Deployment

Import the GitHub repository into Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then deploy. Configure the Supabase Auth Site URL and redirect URL to the Vercel domain.

Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS application origin in Vercel (for example, `https://creditbook.example`). Team invitation links fail closed in production when this value is missing, so they cannot be redirected through an untrusted Host header.

## Supabase Auth email templates

In Supabase Dashboard → Authentication → Email Templates, use Supabase's `{{ .ConfirmationURL }}` variable for confirmation and invitation links. Do not construct the verification URL manually with a token placeholder. After changing a template, send a fresh signup and invitation email and verify that the link contains `token=` and completes at `/auth/callback`.
