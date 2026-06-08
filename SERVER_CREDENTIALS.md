# Server Credentials

Do not put real credentials in GitHub, frontend files, `localStorage`, or run notes.

For the current Vercel project, store credentials in:

```text
Vercel > connections > Settings > Environment Variables
```

Use these variable names:

```text
MANAGEWP_USERNAME
MANAGEWP_PASSWORD

YAMIX_USERNAME
YAMIX_PASSWORD

SERANKING_USERNAME
SERANKING_PASSWORD
```

Google/Gmail can change per site, so store a server-side map keyed by Gmail address:

```text
GOOGLE_ACCOUNTS_JSON
```

Example shape:

```json
{
  "first-client@gmail.com": "password-for-that-account",
  "second-client@gmail.com": "password-for-that-account"
}
```

The app still asks for `Google email` on each run because that is site-specific. It should not ask for the password in the frontend.

## Important

The current Vercel version is a static UI with `localStorage` run persistence. These environment variables are for the next backend/worker layer. Frontend JavaScript must never read or expose them.

When a backend/worker is added, it should:

1. Read global service credentials from Vercel environment variables.
2. Read the run's Google email.
3. Look up that Google email in `GOOGLE_ACCOUNTS_JSON`.
4. Use the credentials only server-side.
5. Return only status/captured IDs to the frontend, never the secret values.
