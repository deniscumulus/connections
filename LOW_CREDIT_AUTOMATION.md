# Low-Credit Automation Plan

The setup process must not use Codex/AI as the default worker. A normal run should be completed by deterministic backend code and should use **0 AI model calls**.

## Why The Current Prototype Gets Expensive

The static app can create a run, but it cannot control GA4, GSC, ManageWP, SE Ranking, or Yamix by itself. Earlier prototypes treated Codex/browser navigation as the worker. That is expensive because every run can require many screenshots, page reads, decisions, waits, and confirmations.

The production system should use Codex/AI only for exception recovery, not for the main path.

## Target Architecture

1. The operator fills the form once:
   - Site URL
   - Project name
   - Target market
   - Gmail email/password
   - Optional SE Ranking branded keywords
2. The app stores the run and marks it `queued_for_worker`.
3. A backend worker picks up the run.
4. The worker performs the setup using deterministic code:
   - API calls where the service supports it.
   - Playwright with stable selectors where browser navigation is required.
   - Persistent browser profiles/cookies to avoid repeated logins.
5. The worker writes only statuses, captured IDs, and non-secret results back to the run.
6. AI/Codex is used only if deterministic automation fails repeatedly.

## Cost Rules

- Normal run: 0 AI/Codex calls.
- Do not send screenshots, full DOM dumps, credentials, or long logs to an AI model on the normal path.
- Use fixed selectors and service-specific state machines for browser screens.
- Use short polling and structured status updates instead of asking an AI agent to watch the browser.
- If AI recovery is needed, cap it to 1-2 calls per failed step and store the learned fix as code/config.
- Reuse logged-in browser profiles for ManageWP, Yamix, SE Ranking, GA4, and GSC where account policy allows it.
- Never ask Codex to manually run the full site setup for each site in production.

## Worker Strategy

### APIs First

Use official APIs where available and stable. API calls are cheaper and more reliable than browser automation.

Good API candidates:

- Google Analytics property/web stream operations
- Google Search Console property and verification-related operations where supported
- BigQuery dataset/link setup where supported
- WordPress admin operations if credentials/application passwords are available
- SE Ranking operations if the account plan exposes the needed API
- Yamix internal API endpoints if available

If an API is unavailable or incomplete, fall back to deterministic Playwright.

### Deterministic Playwright Fallback

For browser-only steps:

- Navigate directly to known URLs.
- Wait for specific selectors, not visual interpretation.
- Fill forms by labels/selectors.
- Capture IDs from URLs, DOM text, or API responses.
- Save one failure screenshot only when a step fails.
- Pause for operator only for captcha, 2FA, unexpected UI changes, or missing permissions.

### AI Recovery Only

Use AI only after deterministic code fails, for example:

- A selector changed.
- A button moved and no known selector matches.
- A service shows an unexpected interstitial.

The AI recovery request should include:

- The current step name.
- A small HTML/ARIA excerpt.
- One screenshot if needed.
- The list of selectors already tried.
- The expected action.

It should not include passwords or full run history.

## Required Metrics

Each run should store:

- `modelCalls`: number of AI/Codex calls used
- `aiRecoveryUsed`: true/false
- `browserSteps`: number of deterministic browser actions
- `apiCalls`: number of API calls
- `operatorTakeovers`: number of manual pauses
- `failureReason`: if failed

The dashboard should show these values so the team can see when a run became expensive.

## Current App Status

The UI now queues new runs as `queued_for_worker`, not `queued_for_codex`.

This is still a static Vercel prototype. It creates and displays runs, but it does not yet contain the backend worker. The next implementation step is to add a server-side queue and worker that performs the setup without using Codex as the normal execution engine.
