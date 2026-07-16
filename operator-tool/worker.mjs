import { setTimeout as sleep } from "node:timers/promises";
import { setupGA4 } from "./ga4-automation.mjs";
import { setupGSC } from "./gsc-automation.mjs";
import { setupSERanking } from "./seranking-automation.mjs";

const apiBase = process.env.WORKER_API_BASE || "http://127.0.0.1:4173";
const basicAuthUser = process.env.BASIC_AUTH_USER || "";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 15000);

// "inputs" is always done at run creation; these are the steps the worker sequences.
const STEP_ORDER = ["yamix", "googleAnalytics", "searchConsole", "manageWpHfcm", "seRanking", "finalCheck"];

const STEP_LABEL = {
  yamix: "Yamix Existing Project",
  googleAnalytics: "Google Analytics",
  searchConsole: "Google Search Console",
  manageWpHfcm: "ManageWP and HFCM",
  seRanking: "SE Ranking",
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

// No per-service automation is implemented yet (no Google/ManageWP/Yamix/SE Ranking
// logins). Until that exists, the worker's job is only to sequence steps and hand
// each one to the operator, instead of leaving the run silently stuck as "queued".
async function flagNeedsOperator(run, stepKey) {
  const timestamp = new Date().toISOString();
  const reason = `Automation for "${STEP_LABEL[stepKey] || stepKey}" is not implemented yet. Complete this step manually, then click Resume automation.`;

  return api(`/api/runs/${run.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      automation: {
        ...(run.automation || {}),
        status: "needs_operator",
        currentStep: stepKey,
        worker: "worker_v1",
        message: reason
      },
      steps: {
        [stepKey]: {
          ...(run.steps?.[stepKey] || {}),
          status: "blocked",
          note: reason
        }
      },
      logs: [...(run.logs || []), { at: timestamp, level: "warning", message: `Worker: ${reason}` }]
    })
  });
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

// Picks up runs nobody has claimed yet and hands the first step to the operator.
async function processQueued() {
  const run = await api("/api/runs/next-queued");
  if (!run) return;

  console.log(`[worker] claiming run ${run.id} (${run.hostname})`);
  const claimed = await api(`/api/runs/${run.id}/claim`, { method: "POST" });

  const stepKey = firstIncompleteStep(claimed) || "finalCheck";
  await flagNeedsOperator(claimed, stepKey);
  console.log(`[worker] run ${run.id} needs operator at step "${stepKey}"`);
}

// Handle step automation (GA4, GSC, etc). Returns updated run or null if needs operator pause.
async function handleStepAutomation(run, stepKey) {
  const timestamp = new Date().toISOString();

  if (stepKey === "googleAnalytics") {
    console.log(`[worker] attempting GA4 automation for run ${run.id}`);
    const result = await setupGA4(run);

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
    const result = await setupGSC(run);

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
    const result = await setupSERanking(run);

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
        seRankingCreated: true,
        seRankingGa4Connected: true,
        seRankingGscConnected: true
      },
      logs: [...(run.logs || []), { at: timestamp, level: "info", message: `SE Ranking setup complete. Project: ${result.seRankingProjectId}` }]
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

// Picks up runs the operator resumed (status "running"). Mark the current step
// done, then advance to the next incomplete step (or mark all complete).
async function processResumed() {
  const runs = await api("/api/runs");
  const resumed = runs.filter((run) => run.automation?.status === "running");

  for (const run of resumed) {
    const stepKey = run.automation.currentStep;
    const timestamp = new Date().toISOString();

    // Mark the step the operator just completed as done
    const updated = await api(`/api/runs/${run.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        steps: {
          [stepKey]: {
            ...(run.steps?.[stepKey] || {}),
            status: "done",
            note: "Operator completed this step."
          }
        },
        logs: [...(run.logs || []), { at: timestamp, level: "info", message: `Worker: ${stepKey} marked done by operator.` }]
      })
    });

    const next = firstIncompleteStep(updated);
    if (!next) {
      await markComplete(updated);
      console.log(`[worker] run ${run.id} complete`);
      continue;
    }

    // Try to automate the next step
    const stepUpdate = await handleStepAutomation(updated, next);
    const patch = {
      automation: stepUpdate.automation,
      steps: stepUpdate.steps,
      logs: stepUpdate.logs,
      ...(stepUpdate.captured && { captured: stepUpdate.captured }),
      ...(stepUpdate.confirmations && { confirmations: stepUpdate.confirmations })
    };

    await api(`/api/runs/${run.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });

    if (stepUpdate.automation?.status === "needs_operator") {
      console.log(`[worker] run ${run.id} paused at step "${next}" for operator`);
    } else {
      console.log(`[worker] run ${run.id} automated step "${next}"`);
    }
  }
}

async function loop() {
  console.log(`[worker] started. API base: ${apiBase}, poll interval: ${pollIntervalMs}ms`);
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
