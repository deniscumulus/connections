# Server Credentials

Do not put global service credentials in GitHub, frontend files, `localStorage`, or run notes.

For the current Vercel project, store global service credentials in:

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

Google/Gmail changes per site, so the operator enters the Gmail email and Gmail password in the run form. The frontend should mask the password field and never print the value in summaries or logs.

In the current static prototype, run data is stored in the browser's `localStorage`, so Gmail passwords entered for test runs live in that browser storage. In the production backend version, send the Gmail password directly to the worker/API and avoid storing it after the run finishes.

## Important

The current Vercel version is a static UI with `localStorage` run persistence. These environment variables are for the next backend/worker layer. Frontend JavaScript must never read or expose global service credentials.

When a backend/worker is added, it should:

1. Read ManageWP, Yamix, and SE Ranking credentials from Vercel environment variables.
2. Read the run's target market and Gmail email/password from the submitted run payload.
3. Use the target market for market-specific setup, especially SE Ranking.
4. Use the Gmail credentials only for GA4/GSC login during that run.
5. Clear or encrypt any temporary secret storage after the run finishes.
6. Return only status/captured IDs to the frontend, never secret values.
