import { setTimeout as sleep } from "node:timers/promises";
import { setupGA4 } from "./ga4-automation.mjs";
import { setupGSC } from "./gsc-automation.mjs";
import { setupSERanking } from "./seranking-automation.mjs";
import { setupManageWPHFCM } from "./managewp-automation.mjs";
import { setupYamixUpdate } from "./yamix-automation.mjs";

const apiBase = process.env.WORKER_API_BASE || "http://127.0.0.1:4173";
const basicAuthUser = process.env.BASIC_AUTH_USER || "";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 15000);

// Passwords are transported base64-encoded (via *_B64 env vars) so special
// characters like "$" survive the .env / docker-compose layers intact. Falls
// back to the plain var for backward compatibility.
function fromB64(value) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Server-side credentials (loaded from env vars, NOT from run)
const credentials = {
  googlePassword: fromB64(process.env.GOOGLE_PASSWORD_B64) || process.env.GOOGLE_PASSWORD || "",
  managewpEmail: process.env.MANAGEWP_EMAIL || "",
  managewpPassword: fromB64(process.env.MANAGEWP_PASSWORD_B64) || process.env.MANAGEWP_PASSWORD || "",
  yamixEmail: process.env.YAMIX_EMAIL || "",
  yamixPassword: fromB64(process.env.YAMIX_PASSWORD_B64) || process.env.YAMIX_PASSWORD || "",
  seRankingEmail: process.env.SERANKING_EMAIL || "",
  seRankingPassword: fromB64(process.env.SERANKING_PASSWORD_B64) || process.env.SERANKING_PASSWORD || "",
  seRankingApiKey: process.env.SERANKING_API_KEY || ""
};

// Manual before the run: create the Google account and connect the site to GA4 +
// GSC, then copy the GA4 property number (from the GA4 URL, after "p") into the form.
// The tool then: creates the SE Ranking project and captures its IDs; derives the
// GA4 dataset (analytics_<propertyId>) and GSC dataset (searchconsole_<site>) names;
// and creates the Yamix project filled with all of it. Yamix runs last.
const STEP_ORDER = ["seRanking", "yamix", "finalCheck"];

const STEP_LABEL = {
  seRanking: "SE Ranking",
  yamix: "Yamix New Project",
  finalCheck: "Final check"
};

function authHeader() {
  if (!basicAuthUser || !basicAuthPassword) return {};
  const token = Buffer.from(`${basicAuthUser}:${basicAuthPassword}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

async function api(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...authHeader(), ...(options.headers || {}) }
  });
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

function firstIncompleteStep(run) {
  return STEP_ORDER.find((key) => (run.steps?.[key]?.status || "todo") !== "done") || null;
}

async function markComplete(run) {
  const timestamp = new Date().toISOString();
  return api(`/api/runs/${run.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      automation: { ...run.automation, status: "done", message: "All steps complete." },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: "Worker: all steps complete." }]
    })
  });
}

// Runs the automation for one step, persists the result, and reports whether the
// run is now blocked (needs an operator) so the caller knows to stop.
async function runStep(run, stepKey) {
  const stepUpdate = await handleStepAutomation(run, stepKey);
  const blocked = stepUpdate.automation?.status === "needs_operator";

  const automation = stepUpdate.automation
    ? { ...stepUpdate.automation, currentStep: stepKey }
    : { ...(run.automation || {}), status: "running", currentStep: stepKey };

  const patch = {
    automation,
    ...(stepUpdate.steps && { steps: stepUpdate.steps }),
    ...(stepUpdate.logs && { logs: stepUpdate.logs }),
    ...(stepUpdate.captured && { captured: stepUpdate.captured }),
    ...(stepUpdate.confirmations && { confirmations: stepUpdate.confirmations })
  };

  const updated = await api(`/api/runs/${run.id}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  return { updated, blocked };
}

// Drives a run forward through its steps until one needs an operator, a step
// fails to advance, or every step is done.
async function driveRun(run) {
  let current = run;
  let guard = null;
  for (;;) {
    const next = firstIncompleteStep(current);
    if (!next) {
      await markComplete(current);
      console.log(`[worker] run ${current.id} complete`);
      return;
    }
    if (next === guard) {
      console.error(`[worker] run ${current.id} step "${next}" did not advance; stopping to avoid a loop`);
      return;
    }

    console.log(`[worker] run ${current.id} running step "${next}"`);
    const { updated, blocked } = await runStep(current, next);
    if (blocked) {
      console.log(`[worker] run ${current.id} paused at step "${next}" for operator`);
      return;
    }
    guard = next;
    current = updated;
  }
}

// Picks up a queued run and drives it forward automatically.
async function processQueued() {
  const run = await api("/api/runs/next-queued");
  if (!run) return;

  console.log(`[worker] claiming run ${run.id} (${run.hostname})`);
  const claimed = await api(`/api/runs/${run.id}/claim`, { method: "POST" });
  await driveRun(claimed);
}

// Handle step automation (GA4, GSC, etc). Returns updated run or null if needs operator pause.
async function handleStepAutomation(run, stepKey) {
  const timestamp = new Date().toISOString();

  if (stepKey === "googleAnalytics") {
    console.log(`[worker] attempting GA4 automation for run ${run.id}`);
    const result = await setupGA4(run, credentials.googlePassword);

    if (result.needsOperator) {
      return {
        automation: { ...run.automation, status: "needs_operator", message: `GA4: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `GA4: ${result.error}` }]
      };
    }

    if (!result.success) {
      console.error(`[worker] GA4 failed: ${result.error}`);
      return {
        automation: { ...run.automation, status: "needs_operator", message: `GA4 error: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "error", message: `GA4 error: ${result.error}` }]
      };
    }

    // GA4 succeeded, capture the IDs
    console.log(`[worker] GA4 succeeded for run ${run.id}: propertyId=${result.ga4PropertyId}`);
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: `GA4 Property ID: ${result.ga4PropertyId}` }
      },
      captured: {
        ...(run.captured || {}),
        ga4PropertyId: result.ga4PropertyId,
        ga4WebStreamId: result.ga4WebStreamId,
        ga4MeasurementId: result.ga4MeasurementId,
        ga4BigQueryProjectId: result.ga4BigQueryProjectId,
        bigQueryDatasetLocation: result.bigQueryDatasetLocation
      },
      confirmations: {
        ...(run.confirmations || {}),
        ga4Created: true,
        ga4BigQueryLinked: result.ga4BigQueryLinked
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: `GA4 setup complete. Property: ${result.ga4PropertyId}` }]
    };
  }

  if (stepKey === "searchConsole") {
    console.log(`[worker] attempting GSC automation for run ${run.id}`);
    const result = await setupGSC(run, credentials.googlePassword);

    if (result.needsOperator) {
      return {
        automation: { ...run.automation, status: "needs_operator", message: `GSC: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `GSC: ${result.error}` }]
      };
    }

    if (!result.success) {
      console.error(`[worker] GSC failed: ${result.error}`);
      return {
        automation: { ...run.automation, status: "needs_operator", message: `GSC error: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "error", message: `GSC error: ${result.error}` }]
      };
    }

    console.log(`[worker] GSC succeeded for run ${run.id}`);
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: `GSC verified with content: ${result.gscVerificationContent.substring(0, 20)}...` }
      },
      captured: {
        ...(run.captured || {}),
        gscVerificationMetaTag: result.gscVerificationMetaTag,
        gscVerificationContent: result.gscVerificationContent,
        gscBulkDataExportDestination: result.gscBulkDataExportDestination,
        gscBulkDataExportDatasetLocation: result.gscBulkDataExportDatasetLocation
      },
      confirmations: {
        ...(run.confirmations || {}),
        gscVerified: true,
        gscBulkDataExportConfigured: result.gscBulkExportConfigured
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: `GSC setup complete. Verification content: ${result.gscVerificationContent.substring(0, 20)}...` }]
    };
  }

  if (stepKey === "seRanking") {
    console.log(`[worker] attempting SE Ranking automation for run ${run.id}`);
    const result = await setupSERanking(run, credentials.seRankingApiKey);

    if (result.needsOperator || !result.success) {
      return {
        automation: { ...run.automation, status: "needs_operator", message: `SE Ranking: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `SE Ranking: ${result.error}` }]
      };
    }

    console.log(`[worker] SE Ranking succeeded for run ${run.id}`);
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: `SE Ranking project: ${result.seRankingProjectId}` }
      },
      captured: {
        ...(run.captured || {}),
        seRankingProjectId: result.seRankingProjectId,
        seRankingBacklinksReportId: result.seRankingBacklinksReportId
      },
      confirmations: {
        ...(run.confirmations || {}),
        seRankingCreated: true
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: `SE Ranking project created. site_id: ${result.seRankingProjectId}` }]
    };
  }

  if (stepKey === "yamix") {
    console.log(`[worker] attempting Yamix project creation for run ${run.id}`);
    const result = await setupYamixUpdate(run, credentials.yamixEmail, credentials.yamixPassword);

    if (result.needsOperator || !result.success) {
      return {
        automation: { ...run.automation, status: "needs_operator", message: `Yamix: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `Yamix: ${result.error}` }]
      };
    }

    console.log(`[worker] Yamix project created for run ${run.id}`);
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: "Yamix project created with GA4, GSC and SE Ranking IDs." }
      },
      confirmations: {
        ...(run.confirmations || {}),
        yamixCreated: true,
        yamixUpdated: result.yamixUpdated
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: "Yamix project created with all captured IDs." }]
    };
  }

  if (stepKey === "manageWpHfcm") {
    console.log(`[worker] attempting ManageWP HFCM automation for run ${run.id}`);
    const result = await setupManageWPHFCM(run, credentials.managewpEmail, credentials.managewpPassword);

    if (result.needsOperator || !result.success) {
      return {
        automation: { ...run.automation, status: "needs_operator", message: `ManageWP: ${result.error}` },
        steps: {
          [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: result.error }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "error", message: `ManageWP HFCM: ${result.error}` }]
      };
    }

    console.log(`[worker] ManageWP HFCM succeeded for run ${run.id}`);
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: "HFCM snippets created and verified" }
      },
      confirmations: {
        ...(run.confirmations || {}),
        hfcmSourceVerified: result.snippetsVerified
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: "ManageWP HFCM snippets created and verified" }]
    };
  }

  if (stepKey === "finalCheck") {
    console.log(`[worker] final check for run ${run.id}`);

    // All work (including Yamix project creation) is done in the earlier steps.
    // Final check just marks the run complete.
    return {
      steps: {
        [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "done", note: "All steps complete." }
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: "Final check complete. All steps done." }]
    };
  }

  // For unimplemented steps, flag as needing operator
  return {
    automation: { ...run.automation, status: "needs_operator", currentStep: stepKey },
    steps: {
      [stepKey]: { ...(run.steps?.[stepKey] || {}), status: "blocked", note: `Automation for "${STEP_LABEL[stepKey]}" not implemented yet.` }
    },
    logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `Worker: step "${stepKey}" needs operator action.` }]
  };
}

// Picks up runs the operator resumed (status "running") and drives them forward.
// driveRun re-runs the current blocked step first, so if the operator resolved
// whatever blocked it (e.g. entered a Google verification code), it continues.
async function processResumed() {
  const runs = await api("/api/runs");
  const resumed = runs.filter((run) => run.automation?.status === "running");

  for (const run of resumed) {
    console.log(`[worker] resuming run ${run.id} at step "${run.automation.currentStep}"`);
    await driveRun(run);
  }
}

async function loop() {
  console.log(`[worker] started. API base: ${apiBase}, poll interval: ${pollIntervalMs}ms`);
  console.log(
    `[worker] credentials: google=${credentials.googlePassword ? "set" : "MISSING"}, managewp=${credentials.managewpEmail ? "set" : "MISSING"}, yamix=${credentials.yamixEmail ? "set" : "MISSING"}, seranking=${credentials.seRankingEmail ? "set" : "MISSING"}`
  );
  for (;;) {
    try {
      await processQueued();
      await processResumed();
    } catch (error) {
      console.error("[worker] cycle error:", error.message);
    }
    await sleep(pollIntervalMs);
  }
}

loop();
