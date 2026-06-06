# Portfolio Setup Operator

Internal setup console for portfolio website onboarding.

The deployable app lives in:

```text
operator-tool/
```

## Local Run

```bash
cd operator-tool
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## Server Deploy

On a server:

```bash
git clone <repo-url>
cd <repo-folder>/operator-tool
cp .env.example .env
docker compose up -d --build
```

Then put HTTPS and authentication in front of it.

See the detailed docs inside `operator-tool/`:

```text
operator-tool/README.md
operator-tool/DEVELOPER_HANDOFF.md
operator-tool/FINAL_WORKFLOW_SPEC.md
operator-tool/HOSTED_SAME_TOOL_DEPLOYMENT.md
```

## Important

Do not commit real credentials, browser cookies, or local run history. The app creates `operator-tool/data/runs.json` locally/server-side at runtime.
