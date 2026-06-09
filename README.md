# Portfolio Setup Operator, Vercel Static Mode

This is a Vercel-compatible conversion of the original Docker/VPS prototype.

## What changed

- The app is static, so it deploys cleanly on Vercel.
- API calls are handled in the browser and persisted with `localStorage`.
- No data is written to Vercel's filesystem.

## Important limitation

This mode is best for one operator in one browser. Runs are not shared across users, devices, or browsers. For team-wide persistence, replace the local storage adapter with Vercel Postgres, KV, Blob, Supabase, Neon, or another real database.

## Credentials

The app asks for Gmail email/password per run because those change by site. Global service credentials for ManageWP, Yamix, and SE Ranking should stay server-side as Vercel environment variables.

See:

```text
SERVER_CREDENTIALS.md
```

## Local preview

```bash
npm start
```

Then open `http://127.0.0.1:4173`.
