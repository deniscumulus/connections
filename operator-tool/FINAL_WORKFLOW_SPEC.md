# Final Workflow Specification

This is the required product behavior.

The current local app is only a prototype/control panel. The final tool must automate the setup after the operator creates a run.

## Desired Operator Experience

1. Operator opens the tool.
2. Operator fills the first form:
   - Domain / site URL
   - Project name
   - Target market
   - Google/Gmail account for GA4 and GSC
   - Optional SE Ranking branded keywords
3. Operator clicks `Create Run`.
4. The system performs the setup.
5. Operator should not manually create GA4, GSC, or SE Ranking projects, and should not manually edit Yamix values.
6. Operator may only be asked for:
   - missing passwords
   - CAPTCHA / verification / 2FA if it appears
   - final confirmation before irreversible `Save` / `Create` actions

If the operator has to manually follow the whole checklist, the final product is not good enough.

## Inputs Needed From Operator

Per site:

- Domain / site URL
- Project name
- Target market
- Gmail address used for Google Analytics and Google Search Console
- Gmail password, if not already saved in the secure credential vault
- SE Ranking branded keywords, optional; blank means auto-generate 5 branded keywords from the project/domain

Global or reusable credentials:

- ManageWP login
- Yamix login
- SE Ranking login

Per-site Google credentials may change from site to site.

The Yamix project already exists before this workflow starts. Market and language are read from that existing Yamix project and reused for SE Ranking. The worker must preserve those Yamix values when saving.

## Credential Handling Requirement

The final hosted version should include a secure Credentials area.

Operators/admins should be able to add:

- Google account email + password
- ManageWP credentials
- Yamix credentials
- SE Ranking credentials

Security rules:

- Do not store passwords in plain text.
- Encrypt credentials at rest.
- Use a server-side encryption key from environment variables or a proper secret manager.
- Never show saved passwords back to users.
- Allow updating/replacing credentials.
- Log credential usage without logging the secret value.

Recommended model:

```text
credentials
  id
  label
  service            # google, managewp, yamix, seranking
  username_or_email
  encrypted_secret
  created_by
  updated_by
  created_at
  updated_at
```

For Google accounts, key credentials by Gmail address so the run can find the correct account.

## Automated Steps After Create Run

### 1. Google Analytics

The system logs into the provided Gmail account and creates:

- GA4 property
- Web stream
- BigQuery link from `GA4 > Product Links > BigQuery Links > Link`

BigQuery requirements from the setup SOP:

- Cloud project ID: use `son-gcloud-452110-e8` unless another value is configured globally or provided on the run.
- Selection path: `Choose a BigQuery project > Specify project by ID`.
- Data location: select `Frankfurt (europe-west3)`.
- Data configuration:
  - `Event data > Include advertising identifiers for mobile app streams`: enabled.
  - `Event data > Export type`: `Daily`, unless estimated daily export volume is over 1 million events, then use `Streaming`.
  - `User data > Export type`: `Daily`.
- Review and submit; capture success only after GA4 shows `LINK CREATED`.

It captures:

- GA4 Property ID
- GA4 Web Stream ID
- GA4 Measurement ID
- BigQuery Cloud project ID used for the link
- BigQuery location used for the link

It derives:

```text
GA4 Dataset Name = analytics_<GA4 Property ID>
```

### 2. Google Search Console

The system logs into the same Gmail account and creates:

- URL-prefix property for the site URL
- Bulk data export from `GSC > Settings > Bulk data export`

Bulk data export requirements from the setup SOP:

- Cloud project ID: use `son-gcloud-452110-e8` unless another value is configured globally or provided on the run.
- Dataset name: the GSC UI has fixed prefix `searchconsole_`; enter only the suffix in the field.
- Dataset suffix rule: use the main domain without the final TLD; replace any other dot or separator with `_`.
- Example: `example.com` -> final dataset `searchconsole_example`; `example.info.com` -> final dataset `searchconsole_example_info`.
- Dataset location: select `Frankfurt (europe-west3)`.
- Capture success only after the setup confirmation appears.

It captures:

- HTML verification meta tag
- verification content value
- Bulk data export destination details
- Bulk data export dataset location

It derives:

```text
GSC Dataset Name = searchconsole_<domain_without_www_and_without_final_tld>
```

Example:

```text
https://www.casinoatlanticspins.com/
searchconsole_casinoatlanticspins
```

### 3. ManageWP + WordPress HFCM

The system logs into ManageWP, opens the matching site, enters WP Admin, and opens HFCM.

It creates two header snippets:

```text
Google Search Console - <project_name>
Google Analytics GA4 - <project_name>
```

GSC snippet:

```html
<meta name="google-site-verification" content="<verification_content>" />
```

GA4 snippet must be saved in HFCM as `Snippet Type: Javascript`, not HTML:

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

After saving snippets, the system verifies:

- snippets exist in page source
- GSC verification succeeds

### 4. SE Ranking

The system logs into SE Ranking and creates a project for the domain.

Rules:

- Add custom branded keywords from the run form when provided.
- If the operator leaves the keyword field empty, auto-generate exactly 5 branded keywords from the project/domain. Example for `freespinandwin.com`: `free spin and win`, `freespinandwin`, `free spin win`, `free spin & win`, `free spin and win casino`.
- No competitors
- Market and language come from the existing Yamix project
- Connect the SE Ranking project to the same GA4 account/property
- Connect the SE Ranking project to the same GSC account/property

It captures:

- SE Ranking Project ID
- SE Ranking Backlinks Report ID

### 5. Yamix

The Yamix project already exists. The system logs into Yamix and goes to:

```text
Settings > Projects
```

It searches for the existing project whose project name/domain matches the run domain, opens edit/view, and reads:

- Market
- Language

It later fills or updates:

- Main Project URL: site URL
- Parent project: `SKY Rocket`
- GSC Dataset Name: generated value
- GA4 Dataset Name: generated value
- SERanking Project ID: captured value
- SERanking Backlinks Report ID: captured value
- Market: preserve existing Yamix value
- Language: preserve existing Yamix value
- Regex Pattern: empty

Then it saves the existing project and verifies the updated values.

Do not use Yamix Data Pull Analytics during setup.

## Expected End State

After one run, the system should show:

- GA4 Property ID
- GA4 Web Stream ID
- GA4 Measurement ID
- GA4 BigQuery link status
- GSC Bulk data export status
- GSC verification tag/content
- HFCM snippet IDs if available
- SE Ranking Project ID
- SE Ranking Backlinks Report ID
- SE Ranking GA4/GSC connection status
- Yamix existing project found/updated status
- Final summary

## Human Intervention Rules

The system can pause for the operator only when:

- Gmail password is missing
- login challenge appears
- CAPTCHA appears
- 2FA appears
- Google or another service changes the UI and automation cannot identify the next step
- final save/create confirmation is required by product policy

The default expectation is: fill form once, click `Create Run`, automation proceeds.
