# Portfolio Setup Operator

Local or hosted setup console for new portfolio sites.

This MVP does not store passwords and does not use external APIs. It gives the operator one place to enter a new site, track the setup status, generate HFCM snippets, and copy the exact Yamix fields.

Important: this MVP is not the final desired automation. The final version should let the operator fill the first form, click `Create Run`, and have the system perform the GA4, GSC, ManageWP/HFCM, SE Ranking, and Yamix setup.

For the final desired behavior, see:

```text
FINAL_WORKFLOW_SPEC.md
```

For the "same tool, but on a server" deployment, see:

```text
HOSTED_SAME_TOOL_DEPLOYMENT.md
```

## Start

```bash
npm start
```

Open:

```text
http://localhost:4173
```

## Operator Inputs

For each site, create a run with:

- Site URL
- Project name
- Google email
- SE Ranking branded keywords, optional; blank means auto-generate 5 branded keywords from the project/domain

Defaults baked into the workflow:

- Yamix parent project: `SKY Rocket`
- Yamix regex pattern: empty
- BigQuery Cloud project ID: `son-gcloud-452110-e8`
- GA4/GSC BigQuery location: `Frankfurt (europe-west3)`
- GSC dataset format: `searchconsole_<domain_without_www_and_without_final_tld>`
- GSC Bulk data export UI: enter only the suffix after the fixed `searchconsole_` prefix
- GA4 HFCM snippet type: `Javascript`
- SE Ranking keywords: custom branded keywords from the form, or exactly 5 auto-generated branded keywords from the project/domain
- SE Ranking competitors: none
- Yamix path: `Settings > Projects`; find the existing project by domain/project name, edit it, and preserve existing market/language

## Workflow

1. Create the run.
2. Open Yamix Projects, find the existing project by domain/project name, and read its market/language.
3. Open GA4 from the run header, create the property/web stream, and link BigQuery from `Product Links > BigQuery Links` using project `son-gcloud-452110-e8`, location `Frankfurt (europe-west3)`, and the SOP export options.
4. Paste GA4 property ID, web stream ID, measurement ID, BigQuery Cloud project ID used by the worker, and BigQuery location into `Captured IDs`.
5. Open GSC, create the URL-prefix property, and configure `Settings > Bulk data export` using project `son-gcloud-452110-e8`, dataset suffix from the domain, and location `Frankfurt (europe-west3)`.
6. Paste the verification meta tag, Bulk data export destination, and export location into `Captured IDs`.
7. Copy the generated GSC and GA4 snippets from `Snippets`.
8. Open ManageWP, enter WP Admin, and add GSC as HFCM HTML in the header and GA4 as HFCM Javascript in the header.
9. Verify GSC ownership.
10. Open SE Ranking, create the project using Yamix market/language, add custom branded keywords or the 5 generated branded keywords, add no competitors, connect its GA4 and GSC account/property, then paste project/backlinks IDs.
11. Reopen the existing Yamix project, fill the captured IDs/dataset values, preserve market/language, and save.
12. Mark the final checklist done.

## Storage

Run state is stored locally in:

```text
data/runs.json
```

Do not store account passwords in run notes.

## Server Mode

The server supports these environment variables:

```text
HOST=0.0.0.0
PORT=4173
DATA_DIR=/app/data
BASIC_AUTH_USER=operator
BASIC_AUTH_PASSWORD=<strong-password>
BIGQUERY_CLOUD_PROJECT_ID=son-gcloud-452110-e8
BIGQUERY_DATA_LOCATION="Frankfurt (europe-west3)"
```

If `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are set, the app is protected with browser basic auth.

## Next Automation Layer

The next layer can add a Playwright worker that clicks through the browser screens. This console should stay as the control panel and source of truth even after deeper browser automation is added.

The final version also needs secure credential storage for Gmail, ManageWP, Yamix, and SE Ranking credentials. Do not store passwords in notes or plain JSON.
