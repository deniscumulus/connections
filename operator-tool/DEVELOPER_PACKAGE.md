# Developer Package

Send the developer this folder:

```text
operator-tool/
```

Important files:

```text
README.md
DEVELOPER_HANDOFF.md
FINAL_WORKFLOW_SPEC.md
HOSTED_SAME_TOOL_DEPLOYMENT.md
package.json
server.mjs
Dockerfile
docker-compose.yml
public/index.html
public/styles.css
public/app.js
data/runs.json
```

## What To Tell The Developer

This is a local MVP/prototype for a hosted internal tool.

The prototype is not enough as the final product. The final product must automate the browser steps with a backend Playwright/Chrome worker.

The desired final behavior is:

1. Operator fills the first form.
2. Operator clicks `Create Run`.
3. System logs into required services and performs the setup.
4. Operator only provides missing credentials/challenges/confirmations when needed.

The current requested next step is simpler than the full final product: host this same tool on a server so it is available to company users, for example:

```text
https://setup.cumuluseo.com
```

For the first hosted version, keeping JSON storage is acceptable if `data/runs.json` is backed up and mounted persistently. Protect it with basic auth or server-level auth. Later, replace JSON storage with a production database and add per-user login.

## How To Run The Prototype

```bash
cd operator-tool
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## Main Product Requirement

Build a hosted internal browser-automation operator console for:

- Google Analytics GA4
- Google Search Console
- ManageWP
- WordPress HFCM
- SE Ranking
- Yamix

Use browser navigation first. APIs are optional future improvements.

## Hard Rules

- Do not store passwords.
- Do not expose the app publicly without auth.
- Final version needs a secure credentials area/vault for Gmail, ManageWP, Yamix, and SE Ranking credentials.
- Do not use Yamix Data Pull Analytics for setup.
- Yamix project already exists before setup. Worker must use `Settings > Projects`, find the existing project by domain/project name, edit it, and preserve market/language.
- Parent project is always `SKY Rocket`.
- Regex pattern is empty.
- SE Ranking starts with custom branded keywords when provided, otherwise exactly 5 auto-generated branded keywords, and no competitors.
- GSC dataset names omit the final TLD, for example `searchconsole_freespinandwin`.
- GA4 must be linked to BigQuery with default Cloud project `son-gcloud-452110-e8`, location `Frankfurt (europe-west3)`, and the SOP data export options.
- GSC Bulk data export must be configured with default Cloud project `son-gcloud-452110-e8`, location `Frankfurt (europe-west3)`, and only the dataset suffix entered after the fixed `searchconsole_` prefix.
- HFCM GSC snippet is HTML; HFCM GA4 snippet is Javascript.
- SE Ranking project must connect to the same GA4 and GSC account/property.
- Keep manual confirmations before final save/create actions.

## First Hosted Version

The first hosted version must be guided browser automation, not just a manual checklist:

- User creates a run.
- Browser worker opens the correct pages.
- Browser worker fills known forms and captures IDs where possible.
- Operator confirms risky save/create actions.
- Operator can paste captured IDs only as fallback.
- App generates snippets and Yamix fields.
- App stores run status.

Cost requirement: the browser worker must be deterministic and should not call Codex/AI on the normal path. Normal runs should use 0 AI model calls. Use AI only for rare selector/UI recovery and then convert the learned fix back into code/config.

Then V2 can harden the click-through steps, error recovery, and resume behavior.
