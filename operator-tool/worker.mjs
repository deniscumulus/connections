import { setTimeout as sleep } from "node:timers/promises";

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

    await flagNeedsOperator(updated, next);
    console.log(`[worker] run ${run.id} advanced to step "${next}"`);
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
