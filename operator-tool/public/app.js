const state = {
  runs: [],
  activeId: null,
  activeTab: "workflow"
};

const DEFAULT_BIGQUERY_PROJECT_ID = "son-gcloud-452110-e8";
const DEFAULT_BIGQUERY_DATA_LOCATION = "Frankfurt (europe-west3)";
const AUTH_SESSION_KEY = "connection_setup_authenticated";
const ACCESS_CODE = "operatorcumuluseo";

// Order must match STEP_ORDER in worker.mjs. GA4 + GSC are set up manually before
// the run (operator provides the GA4 property number). The tool does SE Ranking,
// then creates the Yamix project. Yamix runs last.
// The two real automation steps the operator cares about. "inputs" (the form)
// and "finalCheck" (the summary write) are not shown as progress steps — the
// user only wants to see what the tool has finished and what it is doing now.
const stepMeta = [
  {
    key: "seRanking",
    title: "SE Ranking project",
    text: "Creating the SE Ranking project for the domain and capturing the Project ID + Backlinks Report ID that Yamix needs.",
    links: [{ label: "Open SE Ranking", href: "https://online.seranking.com/login.html" }]
  },
  {
    key: "yamix",
    title: "Yamix project",
    text: "Creating the Yamix project and filling it with the SE Ranking IDs, the GA4/GSC dataset names, the market, language and main URL.",
    links: [{ label: "Open Yamix Projects", href: "https://yamix.com/settings/projects" }]
  }
];

const capturedFields = [
  ["ga4PropertyId", "GA4 Property ID"],
  ["ga4MeasurementId", "GA4 Measurement ID"],
  ["ga4WebStreamId", "GA4 Web Stream ID"],
  ["ga4BigQueryProjectId", "GA4 BigQuery Cloud project ID"],
  ["bigQueryDatasetLocation", "GA4 BigQuery location"],
  ["gscVerificationMetaTag", "GSC verification meta tag"],
  ["gscVerificationContent", "GSC verification content"],
  ["gscBulkDataExportDestination", "GSC bulk data export destination"],
  ["gscBulkDataExportDatasetLocation", "GSC bulk data export location"],
  ["yamixExistingMarket", "Yamix existing market"],
  ["yamixExistingLanguage", "Yamix existing language"],
  ["hfcmGscSnippetId", "HFCM GSC snippet ID"],
  ["hfcmGa4SnippetId", "HFCM GA4 snippet ID"],
  ["seRankingProjectId", "SE Ranking Project ID"],
  ["seRankingBacklinksReportId", "SE Ranking Backlinks Report ID"]
];

const confirmations = [
  ["ga4Created", "GA4 created"],
  ["ga4BigQueryLinked", "GA4 linked to BigQuery"],
  ["gscVerified", "GSC verified"],
  ["gscBulkDataExportConfigured", "GSC bulk data export configured"],
  ["hfcmSourceVerified", "HFCM tags verified in source"],
  ["seRankingCreated", "SE Ranking created"],
  ["seRankingGa4Connected", "SE Ranking connected to GA4"],
  ["seRankingGscConnected", "SE Ranking connected to GSC"],
  ["yamixExistingProjectFound", "Yamix existing project found"],
  ["yamixUpdated", "Yamix project updated"]
];

const els = {
  loginScreen: document.querySelector("#login-screen"),
  appShell: document.querySelector("#app-shell"),
  loginForm: document.querySelector("#login-form"),
  loginAccessCode: document.querySelector("#login-access-code"),
  loginError: document.querySelector("#login-error"),
  logout: document.querySelector("#logout"),
  form: document.querySelector("#new-run-form"),
  formError: document.querySelector("#form-error"),
  runList: document.querySelector("#run-list"),
  refresh: document.querySelector("#refresh-runs"),
  empty: document.querySelector("#empty-state"),
  detail: document.querySelector("#run-detail"),
  runTitle: document.querySelector("#run-title"),
  runSubtitle: document.querySelector("#run-subtitle"),
  stepCount: document.querySelector("#step-count"),
  currentStepTitle: document.querySelector("#current-step-text"),
  stepSpinner: document.querySelector("#step-spinner"),
  stepElapsed: document.querySelector("#step-elapsed"),
  currentStepMessage: document.querySelector("#current-step-message"),
  statusPill: document.querySelector("#status-pill"),
  progressText: document.querySelector("#progress-text"),
  updatedText: document.querySelector("#updated-text"),
  progressBar: document.querySelector("#progress-bar"),
  operatorIntervention: document.querySelector("#operator-intervention"),
  operatorMessage: document.querySelector("#operator-message"),
  takeoverStep: document.querySelector("#takeover-step"),
  resumeAutomation: document.querySelector("#resume-automation"),
  simulateAutomation: document.querySelector("#simulate-automation"),
  needsOperator: document.querySelector("#needs-operator"),
  copyWorkerPayload: document.querySelector("#copy-worker-payload"),
  workflowList: document.querySelector("#workflow-list"),
  capturedForm: document.querySelector("#captured-form"),
  gscSnippet: document.querySelector("#gsc-snippet"),
  ga4Snippet: document.querySelector("#ga4-snippet"),
  yamixFields: document.querySelector("#yamix-fields"),
  summary: document.querySelector("#summary-output"),
  toast: document.querySelector("#toast")
};

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAuthenticated() {
  return window.sessionStorage.getItem(AUTH_SESSION_KEY) === "1";
}

function showLogin(message = "") {
  els.appShell?.classList.add("hidden");
  els.loginScreen?.classList.remove("hidden");
  if (message) {
    els.loginError.textContent = message;
    els.loginError.classList.remove("hidden");
  } else {
    els.loginError.textContent = "";
    els.loginError.classList.add("hidden");
  }
  window.setTimeout(() => els.loginAccessCode?.focus(), 0);
}

async function showApp() {
  els.loginScreen?.classList.add("hidden");
  els.appShell?.classList.remove("hidden");
  await loadRuns();
  startAutoRefresh();
  loadSeSessionStatus();
}

// --- SE Ranking session (cookies pasted through the UI) ---
async function loadSeSessionStatus() {
  const statusEl = document.querySelector("#se-session-status");
  if (!statusEl) return;
  try {
    const meta = await api("/api/seranking-cookies?meta=1");
    statusEl.textContent = meta.savedAt
      ? `— ${meta.count} cookies, updated ${new Date(meta.savedAt).toLocaleString()}`
      : "— not set";
  } catch {
    statusEl.textContent = "";
  }
}

document.querySelector("#se-cookies-save")?.addEventListener("click", async () => {
  const input = document.querySelector("#se-cookies-input");
  const msg = document.querySelector("#se-session-msg");
  const raw = String(input?.value || "").trim();
  msg.classList.add("hidden");
  if (!raw) {
    msg.textContent = "Paste the Cookie-Editor JSON first.";
    msg.classList.remove("hidden");
    return;
  }
  try {
    const result = await api("/api/seranking-cookies", { method: "POST", body: JSON.stringify({ cookies: raw }) });
    input.value = "";
    msg.textContent = `Saved ${result.count} cookies. New runs will use this session.`;
    msg.classList.remove("hidden");
    loadSeSessionStatus();
  } catch (error) {
    msg.textContent = error.message || "Could not save the session.";
    msg.classList.remove("hidden");
  }
});

// Elapsed ticks on its own second, so the counter doesn't jump in 5s steps
// between polls. state.elapsedFrom is null whenever nothing is running.
function updateElapsed() {
  if (!els.stepElapsed) return;
  if (!state.elapsedFrom) {
    els.stepElapsed.textContent = "";
    return;
  }
  const secs = Math.max(0, Math.round((Date.now() - state.elapsedFrom) / 1000));
  const mins = Math.floor(secs / 60);
  els.stepElapsed.textContent = `Running for ${mins ? `${mins}m ` : ""}${secs % 60}s — usually 2–4 minutes. You can switch tabs; this one will tell you when it's done.`;
}
window.setInterval(updateElapsed, 1000);

// Poll the runs so status changes (worker progress) show without a manual refresh.
function startAutoRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = window.setInterval(() => {
    loadRuns().catch(() => {});
  }, 5000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

async function initAuth() {
  if (isAuthenticated()) {
    await showApp();
    return;
  }
  showLogin();
}

els.loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const accessCode = String(els.loginAccessCode?.value || "").trim();

  if (accessCode !== ACCESS_CODE) {
    showLogin("Access code is not correct.");
    els.loginAccessCode.value = "";
    return;
  }

  window.sessionStorage.setItem(AUTH_SESSION_KEY, "1");
  els.loginAccessCode.value = "";
  await showApp();
});

els.logout?.addEventListener("click", () => {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  stopAutoRefresh();
  showLogin();
});

function activeRun() {
  return state.runs.find((run) => run.id === state.activeId) || null;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.setTimeout(() => els.toast.classList.add("hidden"), 1800);
}

function setFormError(message) {
  if (!message) {
    els.formError.textContent = "";
    els.formError.classList.add("hidden");
    return;
  }
  els.formError.textContent = message;
  els.formError.classList.remove("hidden");
}

function statusClass(status) {
  if (status === "done" || status === "simulated_done") return "done";
  if (status === "blocked" || status === "needs_operator" || status === "failed") return "blocked";
  if (status === "in_progress" || status === "running" || status === "queued" || status === "queued_for_worker" || status === "queued_for_codex" || status === "waiting_for_worker") return "in-progress";
  return "";
}

function statusLabel(status) {
  return {
    todo: "Todo",
    queued_for_worker: "Queued for worker",
    queued_for_codex: "Queued for worker",
    queued: "Queued",
    running: "Running",
    waiting_for_worker: "Waiting for worker",
    in_progress: "In progress",
    done: "Done",
    blocked: "Blocked",
    needs_operator: "Needs operator",
    failed: "Failed",
    simulated_done: "Simulated done"
  }[status] || "Todo";
}

function isRunDone(run) {
  const automation = automationFor(run);
  if (["done", "simulated_done"].includes(automation.status)) return true;
  // Both real steps finished (finalCheck is bookkeeping, not shown).
  return stepMeta.every((step) => run.steps?.[step.key]?.status === "done");
}

function progressFor(run) {
  // Only the two real steps count toward progress. A finished run is always
  // 100%, even while the trailing finalCheck bookkeeping settles.
  const keys = stepMeta.map((step) => step.key);
  const total = keys.length || 1;
  const done = keys.filter((key) => run.steps?.[key]?.status === "done").length;
  if (isRunDone(run)) {
    return { done: total, total, percent: 100 };
  }
  return {
    done,
    total,
    percent: Math.round((done / total) * 100)
  };
}

function currentStepKey(run) {
  // Once everything is done, anchor to the last real step (Yamix).
  if (isRunDone(run)) return stepMeta[stepMeta.length - 1].key;
  const automation = automationFor(run);
  // Map any non-visible step (inputs / finalCheck) to the first unfinished
  // real step so the UI never points at a step it doesn't show.
  if (automation.currentStep && stepMeta.some((step) => step.key === automation.currentStep)) {
    return automation.currentStep;
  }
  return stepMeta.find((step) => (run.steps?.[step.key]?.status || "todo") !== "done")?.key || stepMeta[0].key;
}

function currentStep(run) {
  const key = currentStepKey(run);
  return stepMeta.find((step) => step.key === key) || stepMeta[0];
}

function currentStepStatus(run) {
  const key = currentStepKey(run);
  return run.steps?.[key]?.status || automationFor(run).status || "todo";
}

function currentStepNumber(run) {
  const index = stepMeta.findIndex((step) => step.key === currentStepKey(run));
  return index === -1 ? 1 : index + 1;
}

function needsOperator(run) {
  const automation = automationFor(run);
  return ["needs_operator", "blocked", "failed"].includes(automation.status) || ["blocked", "failed", "needs_operator"].includes(currentStepStatus(run));
}

function automationFor(run) {
  return run.automation || {
    status: "queued_for_worker",
    currentStep: "seRanking",
    message: "Queued for the deterministic backend worker.",
    worker: "backend_worker"
  };
}

function credentialRows(run) {
  const credentials = run.credentials || {};
  return [
    ["Google", credentials.google?.email || run.googleEmail, credentials.google?.password ? "Password provided for this run" : "Password missing"],
    ["ManageWP", "Global account", "Stored server-side"],
    ["Yamix", "Global account", "Stored server-side"],
    ["SE Ranking", "Global account", "Stored server-side"]
  ];
}

function logRows(run) {
  return Array.isArray(run.logs) ? run.logs : [];
}

function gscSnippet(run) {
  const tag = run.captured.gscVerificationMetaTag || "";
  const content = run.captured.gscVerificationContent || "";
  if (tag.trim()) return tag.trim();
  if (content.trim()) {
    return `<meta name="google-site-verification" content="${content.trim()}" />`;
  }
  return "<meta name=\"google-site-verification\" content=\"PASTE_VERIFICATION_CONTENT\" />";
}

function ga4Snippet(run) {
  const id = run.captured.ga4MeasurementId || "G-XXXXXXXXXX";
  return `// HFCM snippet type: Javascript
// Location: Header
(function() {
  var measurementId = "${id}";
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
})();`;
}

function yamixRows(run) {
  return [
    ["Project Name", run.projectName],
    ["Main Project URL", run.generated.yamixMainProjectUrl],
    ["Parent project", run.defaults.yamixParentProject],
    ["GSC Dataset Name", run.generated.gscDatasetName],
    ["GA4 Dataset Name", run.generated.ga4DatasetName || "analytics_<GA4 property ID>"],
    ["SERanking Project ID", run.captured.seRankingProjectId],
    ["SERanking Backlinks Report ID", run.captured.seRankingBacklinksReportId],
    ["Market", run.captured.yamixExistingMarket || "Preserve existing Yamix value"],
    ["Language", run.captured.yamixExistingLanguage || "Preserve existing Yamix value"],
    ["Regex Pattern", run.defaults.yamixRegexPattern]
  ];
}

function keywordList(run) {
  const keywords = run.defaults?.seRankingKeywords;
  if (Array.isArray(keywords)) return keywords.filter(Boolean);
  return String(keywords || "")
    .split(/[\n,]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function summaryText(run) {
  const automation = automationFor(run);
  const keywords = keywordList(run);
  const metrics = run.metrics || {};
  return [
    `Project: ${run.projectName}`,
    `Site URL: ${run.siteUrl}`,
    `Target market: ${run.targetMarket || run.market || "not set"}`,
    `Google email: ${run.googleEmail}`,
    `Yamix market: ${run.captured.yamixExistingMarket || "read from existing Yamix project"}`,
    `Yamix language: ${run.captured.yamixExistingLanguage || "read from existing Yamix project"}`,
    `Automation status: ${statusLabel(automation.status)}`,
    `Current step: ${automation.currentStep || ""}`,
    "",
    "Cost metrics",
    `- Model calls: ${metrics.modelCalls ?? 0}`,
    `- AI recovery used: ${metrics.aiRecoveryUsed ? "yes" : "no"}`,
    `- Browser steps: ${metrics.browserSteps ?? 0}`,
    `- API calls: ${metrics.apiCalls ?? 0}`,
    `- Operator takeovers: ${metrics.operatorTakeovers ?? 0}`,
    "",
    "Credentials",
    ...credentialRows(run).map(([service, username, status]) => `- ${service}: ${username || "not set"} (${status})`),
    "",
    "Google Analytics",
    `- Property ID: ${run.captured.ga4PropertyId}`,
    `- Web Stream ID: ${run.captured.ga4WebStreamId}`,
    `- Measurement ID: ${run.captured.ga4MeasurementId}`,
    `- Yamix GA4 Dataset: ${run.generated.ga4DatasetName}`,
    `- BigQuery Cloud project ID: ${run.captured.ga4BigQueryProjectId}`,
    `- BigQuery location: ${run.captured.bigQueryDatasetLocation}`,
    `- BigQuery linked: ${run.confirmations.ga4BigQueryLinked ? "yes" : "no"}`,
    "",
    "Google Search Console",
    `- Dataset: ${run.generated.gscDatasetName}`,
    `- Verification content: ${run.captured.gscVerificationContent}`,
    `- Bulk data export destination: ${run.captured.gscBulkDataExportDestination}`,
    `- Bulk data export location: ${run.captured.gscBulkDataExportDatasetLocation}`,
    `- Bulk data export configured: ${run.confirmations.gscBulkDataExportConfigured ? "yes" : "no"}`,
    "",
    "HFCM",
    `- GSC snippet ID: ${run.captured.hfcmGscSnippetId}`,
    `- GA4 snippet ID: ${run.captured.hfcmGa4SnippetId}`,
    "- GA4 snippet type: Javascript",
    "",
    "SE Ranking",
    `- Project ID: ${run.captured.seRankingProjectId}`,
    `- Backlinks Report ID: ${run.captured.seRankingBacklinksReportId}`,
    `- Target market: ${run.targetMarket || run.market || "not set"}`,
    `- Branded keywords: ${keywords.length ? keywords.join(", ") : "none"}`,
    `- Language source: existing Yamix project`,
    `- GA4 connected: ${run.confirmations.seRankingGa4Connected ? "yes" : "no"}`,
    `- GSC connected: ${run.confirmations.seRankingGscConnected ? "yes" : "no"}`,
    "",
    "Yamix",
    ...yamixRows(run).map(([label, value]) => `- ${label}: ${value}`)
  ].join("\n");
}

function renderRunList() {
  if (!state.runs.length) {
    els.runList.innerHTML = "<p class=\"muted\">No runs yet.</p>";
    return;
  }

  els.runList.innerHTML = state.runs.map((run) => {
    const progress = progressFor(run);
    const automation = automationFor(run);
    return `<button class="run-item ${run.id === state.activeId ? "active" : ""}" type="button" data-run-id="${run.id}">
      <strong>${escapeHtml(run.projectName)}</strong>
      <span>${escapeHtml(run.siteUrl)}</span>
      <span>${statusLabel(automation.status)} | ${progress.done}/${progress.total} steps done</span>
    </button>`;
  }).join("");
}

function renderWorkflow(run) {
  const automation = automationFor(run);
  els.workflowList.innerHTML = stepMeta.map((step) => {
    const status = run.steps?.[step.key]?.status || "todo";
    const note = run.steps?.[step.key]?.note || "";
    return `<article class="workflow-card">
      <div>
        <span class="pill ${statusClass(status)}">${statusLabel(status)}</span>
      </div>
      <div>
        <h3>${step.title}</h3>
        <p class="step-copy">${step.text}</p>
        <div class="step-meta">
          <span>${automation.currentStep === step.key ? "Current step" : "Automated step"}</span>
          ${note ? `<span>${escapeHtml(note)}</span>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderCaptured(run) {
  const credentialSummary = `<div class="full credential-summary">
    <h2>Credential status</h2>
    <div class="credential-grid">
      ${credentialRows(run).map(([service, username, status]) => `<div>
        <span>${escapeHtml(service)}</span>
        <strong>${escapeHtml(username || "Not set")}</strong>
        <em>${escapeHtml(status)}</em>
      </div>`).join("")}
    </div>
  </div>`;

  const fields = capturedFields.map(([key, label]) => {
    const value = run.captured[key] || "";
    const type = key === "gscVerificationMetaTag" ? "textarea" : "input";
    if (type === "textarea") {
      return `<label class="full">${label}<textarea data-captured="${key}">${escapeHtml(value)}</textarea></label>`;
    }
    return `<label>${label}<input data-captured="${key}" value="${escapeHtml(value)}" /></label>`;
  }).join("");

  const checks = confirmations.map(([key, label]) => {
    const checked = run.confirmations[key] ? "checked" : "";
    return `<label><span>${label}</span><input data-confirmation="${key}" type="checkbox" ${checked} /></label>`;
  }).join("");

  els.capturedForm.innerHTML = `${credentialSummary}${fields}<div class="full two-cols">${checks}</div>`;
}

function renderSnippets(run) {
  els.gscSnippet.textContent = gscSnippet(run);
  els.ga4Snippet.textContent = ga4Snippet(run);
}

function renderAutomationStatus(run) {
  const automation = automationFor(run);
  const step = currentStep(run);
  const stepStatus = currentStepStatus(run);
  const blocked = needsOperator(run);
  const link = step.links?.[0]?.href || "";
  const done = isRunDone(run);
  const status = blocked ? "needs_operator" : done ? "done" : automation.status || stepStatus;
  const note = run.steps?.[step.key]?.note || "";

  if (done) {
    els.stepCount.textContent = `${stepMeta.length}/${stepMeta.length} done`;
    els.currentStepTitle.textContent = "All done";
    const yamixNote = run.steps?.yamix?.note || "";
    const pm = yamixNote.match(/parent:\s*([^\n]*)/i);
    let parentLine = "";
    if (pm) {
      const raw = pm[1];
      parentLine = /selected-via-/i.test(raw)
        ? " — Yamix parent: selected ✓"
        : ` — Yamix parent NOT selected → ${raw.trim()}`;
    }
    els.currentStepMessage.textContent =
      "SE Ranking and Yamix projects created. The run is complete." + parentLine;
  } else {
    els.stepCount.textContent = `Step ${currentStepNumber(run)}/${stepMeta.length}`;
    els.currentStepTitle.textContent = step.title;
    els.currentStepMessage.textContent = blocked
      ? automation.message || note || "Automation needs a person to complete the current browser step."
      : step.text || note || automation.message || "";
  }

  // Spinner + elapsed time: a run takes minutes, and with no motion on screen it
  // reads as frozen. Elapsed also makes a genuinely stuck run obvious.
  const running = !done && !blocked;
  els.stepSpinner?.classList.toggle("hidden", !running);
  state.elapsedFrom = running ? Date.parse(run.createdAt || run.updatedAt || "") || Date.now() : null;
  updateElapsed();

  els.statusPill.textContent = statusLabel(status);
  els.statusPill.className = `pill ${statusClass(status)}`;

  els.operatorIntervention.classList.toggle("hidden", !blocked);
  els.operatorMessage.textContent = automation.message || note || "Take over the browser, complete the challenge, then resume automation.";
  els.takeoverStep.disabled = !link;
  els.takeoverStep.textContent = link ? "Take over" : "Manual action needed";
}

function renderYamix(run) {
  els.yamixFields.innerHTML = yamixRows(run).map(([label, value]) => {
    const display = value || "";
    return `<div class="yamix-field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(display)}</strong>
      <button type="button" class="copy-value" data-value="${escapeHtml(display)}">Copy</button>
    </div>`;
  }).join("");
}

function renderDetail() {
  const run = activeRun();
  if (!run) {
    els.empty.classList.remove("hidden");
    els.detail.classList.add("hidden");
    renderRunList();
    return;
  }

  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.runTitle.textContent = run.projectName;
  els.runSubtitle.textContent = `${run.siteUrl} | ${run.targetMarket || run.market || "No target market"}`;

  const progress = progressFor(run);
  // "Step 2/2" (working on step 2) next to "50% complete" (1 of 2 finished) read
  // as a contradiction. Say what the number counts instead of a bare percentage.
  els.progressText.textContent =
    progress.done === progress.total
      ? `All ${progress.total} steps done`
      : `${progress.done} of ${progress.total} steps done`;
  els.updatedText.textContent = `Updated ${new Date(run.updatedAt).toLocaleString()}`;
  els.progressBar.style.width = `${progress.percent}%`;

  renderRunList();
  renderAutomationStatus(run);
  renderWorkflow(run);
  renderCaptured(run);
  renderSnippets(run);
  renderYamix(run);
  els.summary.textContent = summaryText(run);
  renderTabs();
  reflectRunInTab(run);
}

// A run takes minutes while the operator works in other tabs (GA4/GSC), so the
// tab itself reports state: title + favicon change, and finishing/blocking fires
// a notification. Without this you have to keep checking the console by hand.
const TAB_STATES = {
  done: { mark: "✅", color: "#0a7a4a", label: "Done" },
  needs_operator: { mark: "🟠", color: "#a86300", label: "Needs you" },
  running: { mark: "⏳", color: "#2558d6", label: "Running" }
};

function setFavicon(color, mark) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="${color}"/>
    <text x="32" y="45" font-size="34" text-anchor="middle">${mark}</text>
  </svg>`;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function reflectRunInTab(run) {
  const key = isRunDone(run) ? "done" : needsOperator(run) ? "needs_operator" : "running";
  const s = TAB_STATES[key];
  const stepPart = key === "done" ? "" : ` ${currentStepNumber(run)}/${stepMeta.length}`;
  document.title = `${s.mark}${stepPart} ${run.projectName} — Connection setup`;
  setFavicon(s.color, s.mark);

  // Notify only on a real transition, so polling every 5s doesn't spam.
  const prev = state.tabStateByRun?.[run.id];
  if (!state.tabStateByRun) state.tabStateByRun = {};
  state.tabStateByRun[run.id] = key;
  if (prev && prev !== key && (key === "done" || key === "needs_operator")) {
    notify(
      key === "done" ? `${run.projectName}: all done` : `${run.projectName}: needs you`,
      key === "done"
        ? "SE Ranking and Yamix projects created."
        : "The automation is waiting for a manual step."
    );
  }
}

function notify(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/favicon.svg" });
  } catch {
    /* notifications are a nicety, never break the UI over them */
  }
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === state.activeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  document.querySelector(`#tab-${state.activeTab}`)?.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadRuns() {
  state.runs = await api("/api/runs");
  if (!state.activeId && state.runs[0]) state.activeId = state.runs[0].id;
  if (state.activeId && !state.runs.some((run) => run.id === state.activeId)) {
    state.activeId = state.runs[0]?.id || null;
  }
  renderDetail();
}

async function updateRun(id, patch) {
  const next = await api(`/api/runs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  const index = state.runs.findIndex((run) => run.id === id);
  if (index !== -1) state.runs[index] = next;
  renderDetail();
}

function debounce(fn, ms = 450) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

const saveCaptured = debounce(async (target) => {
  const run = activeRun();
  if (!run) return;
  await updateRun(run.id, { captured: { [target.dataset.captured]: target.value } });
}, 500);

const saveStepNote = debounce(async (target) => {
  const run = activeRun();
  if (!run) return;
  await updateRun(run.id, {
    steps: {
      [target.dataset.stepNote]: {
        ...(run.steps[target.dataset.stepNote] || {}),
        note: target.value
      }
    }
  });
}, 500);

function nowIso() {
  return new Date().toISOString();
}

function initialAutomationPatch(raw) {
  const timestamp = nowIso();
  return {
    automation: {
      status: "queued_for_worker",
      worker: "backend_worker",
      currentStep: "seRanking",
      startedAt: timestamp,
      message: "Create Run received. This run is queued for the deterministic backend worker."
    },
    credentials: {
      google: {
        email: String(raw.googleEmail || "").trim(),
        source: "run_form"
      },
      googlePassword: {
        source: "server_env"
      },
      manageWp: {
        source: "server"
      },
      yamix: {
        source: "server"
      },
      seRanking: {
        source: "server"
      }
    },
    targetMarket: String(raw.targetMarket || "").trim(),
    metrics: {
      modelCalls: 0,
      aiRecoveryUsed: false,
      browserSteps: 0,
      apiCalls: 0,
      operatorTakeovers: 0
    },
    steps: {
      inputs: { status: "done", note: "Intake form submitted." },
      yamix: { status: "in_progress", note: "Find existing Yamix project and read market/language." },
      googleAnalytics: { status: "todo", note: "" },
      searchConsole: { status: "todo", note: "" },
      manageWpHfcm: { status: "todo", note: "" },
      seRanking: { status: "todo", note: "" },
      finalCheck: { status: "todo", note: "" }
    },
    logs: [
      {
        at: timestamp,
        level: "info",
        message: "Run created and queued for backend worker pickup."
      }
    ]
  };
}

function simulationPatch(run) {
  const timestamp = nowIso();
  const seed = String(Date.now()).slice(-6);
  const ga4PropertyId = `53${seed}`;
  const measurementId = `G-TEST${seed}`;
  const streamId = `14${seed}67`;
  const verificationContent = `test-verification-${run.hostname.replace(/[^a-z0-9]/g, "-")}`;
  const gscDatasetName = run.generated?.gscDatasetName || `searchconsole_${run.hostname.replace(/^www\./, "").split(".").slice(0, -1).join("_")}`;
  const bigQueryProjectId = run.captured?.ga4BigQueryProjectId || DEFAULT_BIGQUERY_PROJECT_ID;

  return {
    automation: {
      status: "simulated_done",
      worker: "prototype_simulator",
      currentStep: "finalCheck",
      startedAt: run.automation?.startedAt || timestamp,
      completedAt: timestamp,
      message: "Prototype simulation completed. This proves the app flow, not external service automation."
    },
    captured: {
      ga4PropertyId,
      ga4MeasurementId: measurementId,
      ga4WebStreamId: streamId,
      ga4BigQueryProjectId: bigQueryProjectId,
      bigQueryDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
      gscVerificationMetaTag: `<meta name="google-site-verification" content="${verificationContent}" />`,
      gscVerificationContent: verificationContent,
      gscBulkDataExportDestination: run.captured?.gscBulkDataExportDestination || `${bigQueryProjectId}.${gscDatasetName}`,
      gscBulkDataExportDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
      yamixExistingMarket: "Existing Yamix market",
      yamixExistingLanguage: "Existing Yamix language",
      hfcmGscSnippetId: "sim-gsc-1",
      hfcmGa4SnippetId: "sim-ga4-2",
      seRankingProjectId: `12${seed}`,
      seRankingBacklinksReportId: `37${String(seed).slice(-3)}`
    },
    confirmations: {
      ga4Created: true,
      ga4BigQueryLinked: true,
      gscVerified: true,
      gscBulkDataExportConfigured: true,
      hfcmSourceVerified: true,
      seRankingCreated: true,
      seRankingGa4Connected: true,
      seRankingGscConnected: true,
      yamixExistingProjectFound: true,
      yamixUpdated: true,
      yamixCreated: false
    },
    metrics: {
      modelCalls: 0,
      aiRecoveryUsed: false,
      browserSteps: 26,
      apiCalls: 4,
      operatorTakeovers: run.metrics?.operatorTakeovers || 0
    },
    steps: {
      inputs: { status: "done", note: "Intake form submitted." },
      googleAnalytics: { status: "done", note: "Simulated GA4 IDs and BigQuery link captured." },
      searchConsole: { status: "done", note: "Simulated GSC verification and Bulk data export captured." },
      manageWpHfcm: { status: "done", note: "Simulated HFCM snippets saved with GA4 as Javascript." },
      seRanking: { status: "done", note: `Simulated SE Ranking project, branded keywords, and GA4/GSC connections created: ${keywordList(run).join(", ")}` },
      yamix: { status: "done", note: "Simulated existing Yamix project found and updated while preserving market/language." },
      finalCheck: { status: "done", note: "Simulated final checks passed." }
    },
    logs: [
      ...(run.logs || []),
      { at: timestamp, level: "info", message: "Prototype simulation filled captured IDs and marked all steps done." }
    ]
  };
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(els.form);
  const raw = Object.fromEntries(formData.entries());
  const missing = [];
  if (!String(raw.siteUrl || "").trim()) missing.push("Site URL");
  if (!String(raw.targetMarket || "").trim()) missing.push("Target market");
  if (!String(raw.ga4PropertyId || "").trim()) missing.push("GA4 property number");
  if (missing.length) {
    setFormError(`Required before start: ${missing.join(", ")}`);
    showToast("Missing required fields");
    els.form.querySelector("[name='siteUrl'], [name='targetMarket'], [name='ga4PropertyId']")?.focus();
    return;
  }
  setFormError("");
  // Ask here, on a real click — browsers reject permission prompts on page load,
  // and this is the moment the operator actually wants to be told when it ends.
  try {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* ignore */
  }
  const payload = {
    siteUrl: raw.siteUrl,
    targetMarket: raw.targetMarket,
    ga4PropertyId: raw.ga4PropertyId,
    seRankingKeywords: raw.seRankingKeywords
  };
  const run = await api("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const startedRun = await api(`/api/runs/${run.id}`, {
    method: "PATCH",
    body: JSON.stringify(initialAutomationPatch(raw))
  });
  state.runs.unshift(startedRun);
  state.activeId = startedRun.id;
  els.form.reset();
  showToast("Run created and automation requested");
  renderDetail();
});

els.refresh.addEventListener("click", () => loadRuns());

els.simulateAutomation.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  await updateRun(run.id, simulationPatch(run));
  showToast("Prototype automation simulated");
});

els.needsOperator.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  const timestamp = nowIso();
  await updateRun(run.id, {
    automation: {
      ...automationFor(run),
      status: "needs_operator",
      message: "Automation paused for operator input or login challenge.",
      pausedAt: timestamp
    },
    steps: {
      [automationFor(run).currentStep || "googleAnalytics"]: {
        ...(run.steps?.[automationFor(run).currentStep || "googleAnalytics"] || {}),
        status: "blocked",
        note: "Needs operator input."
      }
    },
    logs: [
      ...(run.logs || []),
      { at: timestamp, level: "warning", message: "Run marked as needing operator input." }
    ],
    metrics: {
      ...(run.metrics || {}),
      operatorTakeovers: (run.metrics?.operatorTakeovers || 0) + 1
    }
  });
  showToast("Marked as needing operator");
});

els.takeoverStep.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  const step = currentStep(run);
  const href = step.links?.[0]?.href || "";
  if (href) window.open(href, "_blank", "noopener");
  const timestamp = nowIso();
  await updateRun(run.id, {
    automation: {
      ...automationFor(run),
      status: "needs_operator",
      currentStep: step.key,
      operatorTakeoverAt: timestamp,
      message: "Operator has taken over this step. Complete the browser challenge, then click Resume automation."
    },
    steps: {
      [step.key]: {
        ...(run.steps?.[step.key] || {}),
        status: "blocked",
        note: "Operator takeover in progress."
      }
    },
    logs: [
      ...(run.logs || []),
      { at: timestamp, level: "warning", message: `Operator takeover started for ${step.title}.` }
    ],
    metrics: {
      ...(run.metrics || {}),
      operatorTakeovers: (run.metrics?.operatorTakeovers || 0) + 1
    }
  });
});

els.resumeAutomation.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  const step = currentStep(run);
  const timestamp = nowIso();
  await updateRun(run.id, {
    automation: {
      ...automationFor(run),
      status: "running",
      currentStep: step.key,
      resumedAt: timestamp,
      message: "Operator completed the manual step. Automation can resume."
    },
    steps: {
      [step.key]: {
        ...(run.steps?.[step.key] || {}),
        status: "in_progress",
        note: "Operator completed manual action; resuming automation."
      }
    },
    logs: [
      ...(run.logs || []),
      { at: timestamp, level: "info", message: `Automation resumed after operator action for ${step.title}.` }
    ]
  });
  showToast("Automation marked ready to resume");
});

els.copyWorkerPayload.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  await navigator.clipboard.writeText(JSON.stringify({
    runId: run.id,
    projectName: run.projectName,
    siteUrl: run.siteUrl,
    targetMarket: run.targetMarket || run.market || "",
    googleEmail: run.googleEmail,
    automationStatus: automationFor(run).status,
    worker: "backend_worker",
    note: "Use the deterministic worker. Use AI/Codex only for exception recovery."
  }, null, 2));
  showToast("Worker payload copied");
});

els.runList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-run-id]");
  if (!button) return;
  state.activeId = button.dataset.runId;
  renderDetail();
});

document.querySelector(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;
  renderTabs();
});

els.workflowList.addEventListener("change", async (event) => {
  const run = activeRun();
  if (!run) return;
  const select = event.target.closest("[data-step-status]");
  if (!select) return;
  const key = select.dataset.stepStatus;
  await updateRun(run.id, {
    steps: {
      [key]: {
        ...(run.steps[key] || {}),
        status: select.value
      }
    }
  });
});

els.workflowList.addEventListener("input", (event) => {
  const target = event.target.closest("[data-step-note]");
  if (target) saveStepNote(target);
});

els.capturedForm.addEventListener("input", (event) => {
  const target = event.target.closest("[data-captured]");
  if (target) saveCaptured(target);
});

els.capturedForm.addEventListener("change", async (event) => {
  const run = activeRun();
  if (!run) return;
  const target = event.target.closest("[data-confirmation]");
  if (!target) return;
  await updateRun(run.id, { confirmations: { [target.dataset.confirmation]: target.checked } });
});

document.body.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy]");
  const valueButton = event.target.closest("[data-value]");
  if (!copyButton && !valueButton) return;

  const run = activeRun();
  let text = "";
  if (valueButton) text = valueButton.dataset.value || "";
  if (copyButton?.dataset.copy === "gscSnippet") text = gscSnippet(run);
  if (copyButton?.dataset.copy === "ga4Snippet") text = ga4Snippet(run);
  if (copyButton?.dataset.copy === "summary") text = summaryText(run);
  await navigator.clipboard.writeText(text);
  showToast("Copied");
});

initAuth().catch((error) => {
  console.error(error);
  showToast(error.message);
});
