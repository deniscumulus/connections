# Developer Handoff: Hosted Portfolio Setup Automation

## Goal

Build a hosted internal web app that helps CumulusEO operators set up each new portfolio website through browser navigation.

The current MVP in this folder is a local operator console. It should be treated as a prototype for the hosted product, not as production infrastructure.

Important: the operator does not want a manual checklist as the final product. The final product must include a browser automation worker that performs the setup steps. The dashboard is only the control plane and fallback/resume surface.

Target production URL example:

```text
https://setup.cumuluseo.com
```

Read this together with:

```text
FINAL_WORKFLOW_SPEC.md
```

The final workflow is: the operator fills the first form and clicks `Create Run`; the system then performs the GA4, GSC, ManageWP/HFCM, SE Ranking, and Yamix setup. Manual checklist behavior is only acceptable for the temporary prototype.

## What The Tool Automates

For every new WordPress portfolio site, the operator enters:

- Site URL / domain
- Project name
- Google account email for that site
- SE Ranking branded keywords, optional; blank means auto-generate 5 branded keywords from the project/domain

The system then guides or automates this workflow:

1. Create GA4 property and web stream.
2. Link GA4 to BigQuery from `GA4 > Product Links > BigQuery Links > Link` using the SOP Cloud project, location, and export options.
3. Capture GA4 Property ID, Web Stream ID, Measurement ID, BigQuery Cloud project ID, and BigQuery location.
4. Create Google Search Console URL-prefix property.
5. Configure `GSC > Settings > Bulk data export`.
6. Capture GSC HTML verification meta tag, Bulk data export destination, and export location.
7. Open ManageWP and enter the site's WP Admin.
8. Add two HFCM header snippets:
   - `Google Search Console - <project>` as HTML
   - `Google Analytics GA4 - <project>` as Javascript
9. Verify Search Console ownership.
10. Read market/language from the existing Yamix project.
11. Create SE Ranking project using the Yamix market/language.
12. Add custom branded keywords from the run form when provided; otherwise auto-generate exactly 5 branded keywords from the project/domain.
13. Do not add competitors.
14. Connect SE Ranking to the same GA4 account/property and GSC account/property.
15. Capture SE Ranking Project ID and Backlinks Report ID.
16. Open Yamix.
17. Go to `Settings > Projects`, find the existing project by domain/project name, fill generated/captured values, preserve market/language, and save.

Yamix `Data Pull Analytics` is not part of setup.

## Current MVP

Current local files:

```text
operator-tool/
  package.json
  server.mjs
  public/
    index.html
    styles.css
    app.js
  data/
    runs.json
  README.md
```

Run locally:

```bash
cd operator-tool
npm start
```

Then open:

```text
http://127.0.0.1:4173
```

The MVP currently provides:

- New run form
- Run checklist
- Captured IDs form
- Generated GSC and GA4 HFCM snippets
- Generated Yamix field values
- Local JSON storage

It does not yet perform server-side browser automation.

This is the main product gap. A plain web page cannot control Google Analytics, Search Console, ManageWP, SE Ranking, or Yamix in another browser tab because of normal browser security boundaries. Production needs a backend Playwright/Chrome worker.

The user expectation is not that operators manually create GA4/GSC/SE Ranking/Yamix after clicking `Create Run`. The expected final behavior is that `Create Run` starts the automation job.

## Production Architecture Recommendation

Use:

- VPS or cloud VM
- Docker
- Node.js web app
- PostgreSQL
- Playwright worker with persistent browser profiles
- Redis or simple DB-backed job queue
- Nginx/Caddy reverse proxy
- HTTPS
- App login for company users

Recommended services:

- Web app: dashboard, authentication, run status
- Worker: browser automation jobs
- Database: projects, runs, step logs, captured IDs
- Browser profile storage: encrypted or server-local restricted volume

Avoid plain shared hosting because Playwright/Chrome needs OS-level browser dependencies.

## Browser Automation Model

This should be a guided browser automation, not a manual checklist.

The worker should click through known screens, fill forms, extract IDs, and write values back to the run. The app should pause and ask the operator to confirm before:

- Submitting login forms
- Saving HFCM snippets
- Creating GA4/GSC resources when Google screens change
- Creating SE Ranking project
- Saving Yamix project

Reason: Google, ManageWP, SE Ranking, and Yamix can change screens, show auth prompts, CAPTCHAs, or validation errors.

## Required Pages In Hosted App

### 1. Login

Company users only.

Minimum roles:

- Admin: can see all runs and manage users
- Operator: can create and operate runs
- Viewer: can only view run results

### 2. Runs List

Columns:

- Project name
- Site URL
- Yamix market, read from the existing project
- Yamix language, read from the existing project
- Current step
- Status
- Created by
- Updated at

### 3. Create Run

Fields:

- Site URL
- Project name
- Google email
- SE Ranking branded keywords, optional

Defaults:

- Yamix parent project: `SKY Rocket`
- Yamix regex pattern: empty
- SE Ranking keywords: custom branded keywords from the form, or exactly 5 auto-generated branded keywords from the project/domain
- SE Ranking competitors: none

### 4. Run Detail

Sections:

- Checklist/workflow
- Browser automation status
- Captured IDs
- Generated snippets
- Yamix fields
- Logs
- Final summary

### 5. Browser Session Viewer

Developer can implement either:

- noVNC browser view
- Playwright screenshot stream with action buttons
- browserless/remote Chrome session view

The operator must be able to see what is happening and take over if required.

## Data Model

Suggested tables:

```text
users
  id
  email
  name
  role
  created_at

runs
  id
  project_name
  site_url
  hostname
  google_email
  yamix_existing_market
  yamix_existing_language
  status
  current_step
  created_by
  created_at
  updated_at

run_captured_values
  run_id
  ga4_property_id
  ga4_measurement_id
  ga4_web_stream_id
  ga4_bigquery_project_id
  bigquery_dataset_location
  gsc_verification_meta_tag
  gsc_verification_content
  gsc_bulk_data_export_destination
  gsc_bulk_data_export_dataset_location
  hfcm_gsc_snippet_id
  hfcm_ga4_snippet_id
  se_ranking_project_id
  se_ranking_backlinks_report_id

run_steps
  id
  run_id
  step_key
  status
  note
  started_at
  completed_at

run_logs
  id
  run_id
  level
  message
  metadata_json
  created_at
```

Do not store account passwords in these tables.

## Generated Value Rules

### GSC Dataset Name

Remove `www.`, remove the final TLD segment, then replace remaining dots or punctuation with underscores:

```text
searchconsole_<domain_without_www_and_without_final_tld>
```

Example:

```text
https://www.casinoatlanticspins.com/
searchconsole_casinoatlanticspins
```

In Google Search Console Bulk data export, the UI shows a fixed `searchconsole_` prefix. The worker should enter only the suffix, for example `casinoatlanticspins`, while Yamix receives the full dataset name `searchconsole_casinoatlanticspins`.

### BigQuery Export Defaults

Use these setup SOP defaults unless the run explicitly overrides them:

```text
Cloud Project ID: son-gcloud-452110-e8
Data/Dataset location: Frankfurt (europe-west3)
```

GA4 BigQuery link data configuration:

```text
Event data > Include advertising identifiers for mobile app streams: enabled
Event data > Export type: Daily, unless estimated daily export volume exceeds 1 million events, then Streaming
User data > Export type: Daily
```

### GA4 Dataset Name

Use GA4 Property ID:

```text
analytics_<ga4_property_id>
```

Example:

```text
analytics_535913404
```

### HFCM GSC Snippet

Use the full GSC meta tag:

```html
<meta name="google-site-verification" content="<verification_content>" />
```

### HFCM GA4 Snippet

Save this in HFCM as `Snippet Type: Javascript`, not HTML:

```js
(function() {
  var measurementId = "<measurement_id>";
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function() {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
})();
```

## Yamix Existing Project Fields

Path:

```text
Yamix > Settings > Projects
```

Find the existing project whose project name/domain matches the run domain, then open it for edit.

Fields:

- Main Project URL: site URL
- Parent project: `SKY Rocket`
- GSC Dataset Name: generated
- GA4 Dataset Name: generated after GA4 Property ID is known
- SERanking Project ID: captured from SE Ranking
- SERanking Backlinks Report ID: captured from SE Ranking
- Market: preserve existing Yamix value and use it for SE Ranking
- Language: preserve existing Yamix value and use it for SE Ranking
- Regex Pattern: empty

Do not use Yamix `Data Pull Analytics` during setup.

## Security Requirements

- Do not commit or store passwords.
- Use a secret manager or encrypted environment variables for service credentials if automation needs shared credentials.
- Prefer per-user login for auditability.
- Store browser session cookies only in restricted server storage.
- Encrypt backups.
- Use HTTPS only.
- Add audit logs for every resource creation.
- Add manual confirmation before form submissions that create or modify external resources.
- Restrict access by company email or SSO.

## Environment Variables

Suggested:

```text
NODE_ENV=production
APP_BASE_URL=https://setup.cumuluseo.com
DATABASE_URL=postgres://...
SESSION_SECRET=...
COOKIE_SECRET=...
ENCRYPTION_KEY=...
PLAYWRIGHT_BROWSER_PROFILE_DIR=/var/lib/setup-operator/browser-profiles
WORKER_CONCURRENCY=1
```

Only add service credentials if the company approves shared automation accounts.

## Deployment Notes

Recommended deployment:

1. Provision VPS with Ubuntu LTS.
2. Install Docker and Docker Compose.
3. Run Postgres container.
4. Run web app container.
5. Run Playwright worker container.
6. Mount persistent browser profile volume.
7. Put Nginx/Caddy in front with HTTPS.
8. Configure DNS for `setup.cumuluseo.com`.
9. Configure daily DB backups.

Worker concurrency should start at `1` because multiple concurrent browser jobs can conflict with shared sessions.

## Acceptance Criteria For V1

V1 is acceptable when:

- Users can log in.
- Operators can create a run.
- Run data is stored in Postgres.
- The system generates GSC dataset, GA4 dataset, HFCM snippets, and Yamix fields.
- GSC dataset names omit the final TLD, for example `searchconsole_freespinandwin`.
- The generated GA4 HFCM snippet is Javascript-only and is saved as HFCM `Javascript`.
- GA4 BigQuery link uses `son-gcloud-452110-e8`, `Frankfurt (europe-west3)`, and confirms `LINK CREATED`.
- GSC Bulk data export uses `son-gcloud-452110-e8`, `Frankfurt (europe-west3)`, and the dataset suffix after the fixed `searchconsole_` prefix.
- Operators can open/continue each workflow step.
- Browser automation can at minimum open the correct services and preserve session state.
- Operator can paste captured IDs and mark steps complete.
- Final summary is generated.
- No passwords are stored in the database or repository.
- App is accessible from a company URL over HTTPS.

## Acceptance Criteria For V2

V2 should add deeper automation:

- GA4 creation click-through
- GA4 BigQuery product link setup and status capture
- GSC property creation and meta tag capture
- GSC Bulk data export setup and status capture
- ManageWP site search and WP Admin opening
- HFCM snippet creation
- GSC verification click
- SE Ranking project creation, GA4/GSC connection, and ID capture
- Existing Yamix project lookup/update
- Screenshots/logs for failures
- Resume from failed step

## Pilot Reference

Completed pilot:

```text
Project: casinoatlanticspins.com
Site URL: https://www.casinoatlanticspins.com/
Market: read from existing Yamix project
Language: read from existing Yamix project
GA4 Measurement ID: G-NZLFNXWNDG
GA4 Property ID: 535913404
BigQuery Project ID: son-gcloud-452110-e8
BigQuery/GSC location: Frankfurt (europe-west3)
GSC Dataset: searchconsole_casinoatlanticspins
GA4 Dataset: analytics_535913404
SE Ranking Project ID: 12056120
SE Ranking Backlinks Report ID: 37523
Yamix parent: SKY Rocket
```

Use this pilot as the reference scenario for QA.
