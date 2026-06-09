const state = {
  runs: [],
  activeId: null,
  activeTab: "workflow"
};

const DEFAULT_BIGQUERY_PROJECT_ID = "son-gcloud-452110-e8";
const DEFAULT_BIGQUERY_DATA_LOCATION = "Frankfurt (europe-west3)";
const AUTH_SESSION_KEY = "connection_setup_authenticated";
const ACCESS_CODE_HASH = "fc647fcca5fd04891c8939363e7a381c876b0445160a8ac7e3c00b5a8249c133";

const stepMeta = [
  {
    key: "inputs",
    title: "Inputs",
    text: "Run created from the intake form. Gmail credentials are provided per run; global service credentials stay server-side.",
    links: []
  },
  {
    key: "yamix",
    title: "Yamix Existing Project",
    text: "Automation finds the existing Yamix project by domain/name, reads and preserves market/language, fills captured IDs, then saves.",
    links: [{ label: "Open Yamix Projects", href: "https://yamix.com/settings/projects" }]
  },
  {
    key: "googleAnalytics",
    title: "Google Analytics",
    text: "Automation logs into the provided Gmail account, creates the GA4 property and web stream, links BigQuery, then captures IDs.",
    links: [{ label: "Open GA4", href: "https://analytics.google.com/analytics/web/" }]
  },
  {
    key: "searchConsole",
    title: "Google Search Console",
    text: "Automation creates the URL-prefix property, captures the HTML verification tag, configures Bulk data export, and verifies ownership after HFCM.",
    links: [{ label: "Open GSC", href: "https://search.google.com/search-console/welcome" }]
  },
  {
    key: "manageWpHfcm",
    title: "ManageWP and HFCM",
    text: "Automation opens WP Admin through ManageWP, adds GSC as an HTML header snippet and GA4 as a Javascript header snippet, then checks page source.",
    links: [{ label: "Open ManageWP", href: "https://orion.managewp.com/login" }]
  },
  {
    key: "seRanking",
    title: "SE Ranking",
    text: "Automation creates the SE Ranking project using the market/language read from Yamix, adds custom branded keywords or 5 generated branded keywords, connects GA4 and GSC, then captures IDs.",
    links: [{ label: "Open SE Ranking", href: "https://online.seranking.com/login.html" }]
  },
  {
    key: "finalCheck",
    title: "Final check",
    text: "Automation verifies the final state and writes the run summary.",
    links: []
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
  currentStepTitle: document.querySelector("#current-step-title"),
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
  copyCodexCommand: document.querySelector("#copy-codex-command"),
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
  const hash = await sha256Hex(accessCode);
  if (hash !== ACCESS_CODE_HASH) {
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
  showLogin();
});


const VERCEL_LOCAL_STORAGE_KEY = "portfolio_setup_operator_runs_v1";

const storageMemory = { runs: [] };

const localBrandTerms = [
  "casino",
  "casinos",
  "slots",
  "slot",
  "spins",
  "spin",
  "free",
  "lucky",
  "grand",
  "rocket",
  "cash",
  "mega",
  "fortune",
  "pocket",
  "royal",
  "club",
  "games",
  "game",
  "online",
  "play",
  "win",
  "wins",
  "bet",
  "and"
].sort((a, b) => b.length - a.length);

function storageAvailable() {
  try {
    const testKey = `${VERCEL_LOCAL_STORAGE_KEY}_test`;
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const canUseLocalStorage = storageAvailable();

function getStoredRuns() {
  if (!canUseLocalStorage) return storageMemory.runs.map((run) => applyLocalDerived(structuredClone(run)));
  try {
    const raw = window.localStorage.getItem(VERCEL_LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((run) => applyLocalDerived(run)) : [];
  } catch {
    return [];
  }
}

function setStoredRuns(runs) {
  const normalized = runs.map((run) => applyLocalDerived(run));
  if (!canUseLocalStorage) {
    storageMemory.runs = normalized;
    return;
  }
  window.localStorage.setItem(VERCEL_LOCAL_STORAGE_KEY, JSON.stringify(normalized));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLocalUrl(value) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function domainFromLocalUrl(value) {
  return new URL(value).hostname.toLowerCase();
}

function domainForLocalDataset(hostname) {
  return hostname.replace(/^www\./, "");
}

function domainBaseForLocalDataset(hostname) {
  const parts = domainForLocalDataset(hostname).split(".").filter(Boolean);
  if (parts.length > 1) parts.pop();
  return parts.join(".");
}

function datasetFromLocalDomain(hostname) {
  return `searchconsole_${domainBaseForLocalDataset(hostname).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function gscLocalBulkDestination(hostname, projectId = DEFAULT_BIGQUERY_PROJECT_ID) {
  return `${projectId}.${datasetFromLocalDomain(hostname)}`;
}

function splitLocalCompactBrand(value) {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = [];
  let index = 0;

  while (index < compact.length) {
    const term = localBrandTerms.find((item) => compact.startsWith(item, index));
    if (term) {
      words.push(term);
      index += term.length;
      continue;
    }

    let nextIndex = compact.length;
    for (let cursor = index + 1; cursor < compact.length; cursor += 1) {
      if (localBrandTerms.some((item) => compact.startsWith(item, cursor))) {
        nextIndex = cursor;
        break;
      }
    }
    words.push(compact.slice(index, nextIndex));
    index = nextIndex;
  }

  return words.filter(Boolean);
}

function parseLocalKeywordInput(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueLocalKeywords(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function brandedLocalKeywords({ hostname, projectName, seRankingKeywords }) {
  const provided = parseLocalKeywordInput(seRankingKeywords);
  if (provided.length) return uniqueLocalKeywords(provided).slice(0, 10);

  const rawName = projectName || domainBaseForLocalDataset(hostname);
  const withoutTld = rawName.includes(".") ? domainBaseForLocalDataset(rawName) : rawName;
  const normalizedName = withoutTld.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compact = normalizedName.replace(/\s+/g, "");
  const words = normalizedName.includes(" ") ? normalizedName.split(/\s+/) : splitLocalCompactBrand(compact);
  const spaced = words.join(" ").trim();
  const withoutAnd = spaced.replace(/\band\b/g, "").replace(/\s+/g, " ").trim();
  const ampersand = spaced.replace(/\band\b/g, "&").replace(/\s+/g, " ").trim();
  const withoutLeadingCasino = words[0] === "casino" ? words.slice(1).join(" ").trim() : "";

  return uniqueLocalKeywords([
    spaced,
    compact,
    withoutLeadingCasino,
    withoutAnd,
    ampersand,
    `${withoutLeadingCasino || spaced} casino`,
    `${compact} casino`,
    `${spaced} online`,
    `${compact} online`,
    `${spaced} official`,
    `play ${spaced}`
  ]).slice(0, 5);
}

function defaultLocalSteps() {
  return {
    inputs: { status: "done", note: "" },
    yamix: { status: "todo", note: "" },
    googleAnalytics: { status: "todo", note: "" },
    searchConsole: { status: "todo", note: "" },
    manageWpHfcm: { status: "todo", note: "" },
    seRanking: { status: "todo", note: "" },
    finalCheck: { status: "todo", note: "" }
  };
}

function applyLocalDerived(run) {
  run.generated = run.generated || {};
  run.captured = {
    ga4BigQueryProjectId: DEFAULT_BIGQUERY_PROJECT_ID,
    bigQueryDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
    gscBulkDataExportDestination: "",
    gscBulkDataExportDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
    yamixExistingMarket: "",
    yamixExistingLanguage: "",
    ...(run.captured || {})
  };
  run.confirmations = {
    ga4BigQueryLinked: false,
    gscBulkDataExportConfigured: false,
    seRankingGa4Connected: false,
    seRankingGscConnected: false,
    yamixExistingProjectFound: false,
    yamixUpdated: false,
    ...(run.confirmations || {})
  };
  run.defaults = {
    yamixParentProject: "SKY Rocket",
    yamixRegexPattern: "",
    seRankingKeywords: [],
    seRankingCompetitors: "none",
    ...(run.defaults || {})
  };
  run.steps = { ...defaultLocalSteps(), ...(run.steps || {}) };

  run.defaults.seRankingKeywords = brandedLocalKeywords({
    hostname: run.hostname,
    projectName: run.projectName,
    seRankingKeywords: run.defaults.seRankingKeywords === "none" ? "" : run.defaults.seRankingKeywords
  });

  if (run.hostname) run.generated.gscDatasetName = datasetFromLocalDomain(run.hostname);
  if (!run.captured.ga4BigQueryProjectId) run.captured.ga4BigQueryProjectId = DEFAULT_BIGQUERY_PROJECT_ID;
  if (!run.captured.bigQueryDatasetLocation) run.captured.bigQueryDatasetLocation = DEFAULT_BIGQUERY_DATA_LOCATION;
  if (!run.captured.gscBulkDataExportDestination && run.hostname) {
    run.captured.gscBulkDataExportDestination = gscLocalBulkDestination(run.hostname, run.captured.ga4BigQueryProjectId);
  }
  if (!run.captured.gscBulkDataExportDatasetLocation) {
    run.captured.gscBulkDataExportDatasetLocation = DEFAULT_BIGQUERY_DATA_LOCATION;
  }
  if (run.captured?.ga4PropertyId) {
    run.generated.ga4DatasetName = `analytics_${String(run.captured.ga4PropertyId).trim()}`;
  }
  if (run.captured?.gscVerificationMetaTag) {
    const match = run.captured.gscVerificationMetaTag.match(/content=["']([^"']+)["']/i);
    if (match && !run.captured.gscVerificationContent) run.captured.gscVerificationContent = match[1];
  }
  return run;
}

function buildLocalRun(input) {
  const siteUrl = normalizeLocalUrl(input.siteUrl || input.domain || "");
  const hostname = domainFromLocalUrl(siteUrl);
  const projectName = (input.projectName || domainForLocalDataset(hostname)).trim();
  const bigQueryProjectId = (input.ga4BigQueryProjectId || "").trim() || DEFAULT_BIGQUERY_PROJECT_ID;
  const now = new Date().toISOString();

  return applyLocalDerived({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    projectName,
    siteUrl,
    hostname,
    googleEmail: (input.googleEmail || "").trim(),
    market: "",
    language: "",
    defaults: {
      yamixParentProject: "SKY Rocket",
      yamixRegexPattern: "",
      seRankingKeywords: brandedLocalKeywords({ hostname, projectName, seRankingKeywords: input.seRankingKeywords }),
      seRankingCompetitors: "none"
    },
    generated: {
      gscDatasetName: datasetFromLocalDomain(hostname),
      ga4DatasetName: "",
      yamixMainProjectUrl: siteUrl
    },
    captured: {
      ga4PropertyId: "",
      ga4MeasurementId: "",
      ga4WebStreamId: "",
      ga4BigQueryProjectId: bigQueryProjectId,
      bigQueryDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
      gscVerificationMetaTag: "",
      gscVerificationContent: "",
      gscBulkDataExportDestination: (input.gscBulkDataExportDestination || "").trim() || gscLocalBulkDestination(hostname, bigQueryProjectId),
      gscBulkDataExportDatasetLocation: DEFAULT_BIGQUERY_DATA_LOCATION,
      yamixExistingMarket: "",
      yamixExistingLanguage: "",
      hfcmGscSnippetId: "",
      hfcmGa4SnippetId: "",
      seRankingProjectId: "",
      seRankingBacklinksReportId: ""
    },
    confirmations: {
      ga4Created: false,
      ga4BigQueryLinked: false,
      gscVerified: false,
      gscBulkDataExportConfigured: false,
      hfcmSourceVerified: false,
      seRankingCreated: false,
      seRankingGa4Connected: false,
      seRankingGscConnected: false,
      yamixExistingProjectFound: false,
      yamixUpdated: false,
      yamixCreated: false
    },
    steps: defaultLocalSteps()
  });
}

function mergeLocalRun(current, patch) {
  return applyLocalDerived({
    ...current,
    ...patch,
    generated: { ...(current.generated || {}), ...(patch.generated || {}) },
    captured: { ...(current.captured || {}), ...(patch.captured || {}) },
    confirmations: { ...(current.confirmations || {}), ...(patch.confirmations || {}) },
    steps: { ...(current.steps || {}), ...(patch.steps || {}) },
    updatedAt: new Date().toISOString()
  });
}

async function localApi(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const url = new URL(path, window.location.origin);
  const parts = url.pathname.split("/").filter(Boolean);
  const body = options.body ? JSON.parse(options.body) : {};
  const runs = getStoredRuns();

  if (method === "GET" && url.pathname === "/api/runs") return cloneJson(runs);

  if (method === "GET" && url.pathname === "/api/runs/next-queued") {
    return cloneJson(runs.find((run) => ["queued_for_codex", "waiting_for_worker"].includes(run.automation?.status) || (!run.automation && run.steps?.inputs?.status === "done")) || null);
  }

  if (method === "POST" && url.pathname === "/api/runs") {
    if (!body.siteUrl && !body.domain) throw new Error("siteUrl or domain is required");
    const run = buildLocalRun(body);
    runs.unshift(run);
    setStoredRuns(runs);
    return cloneJson(run);
  }

  if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
    const index = runs.findIndex((run) => run.id === parts[2]);
    if (index === -1) throw new Error("Run not found");

    if (method === "PATCH") {
      const next = mergeLocalRun(runs[index], body);
      runs[index] = next;
      setStoredRuns(runs);
      return cloneJson(next);
    }

    if (method === "DELETE") {
      const [removed] = runs.splice(index, 1);
      setStoredRuns(runs);
      return cloneJson(removed);
    }
  }

  throw new Error(`Unsupported local API route: ${method} ${url.pathname}`);
}

function activeRun() {
  return state.runs.find((run) => run.id === state.activeId) || null;
}

async function api(path, options = {}) {
  try {
    return await localApi(path, options);
  } catch (error) {
    throw new Error(error.message || "Local API request failed");
  }
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
  if (status === "in_progress" || status === "running" || status === "queued" || status === "queued_for_codex" || status === "waiting_for_worker") return "in-progress";
  return "";
}

function statusLabel(status) {
  return {
    todo: "Todo",
    queued_for_codex: "Queued for Codex",
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

function progressFor(run) {
  const values = Object.values(run.steps || {});
  const done = values.filter((step) => step.status === "done").length;
  return {
    done,
    total: values.length || 1,
    percent: Math.round((done / (values.length || 1)) * 100)
  };
}

function currentStepKey(run) {
  const automation = automationFor(run);
  if (automation.currentStep) return automation.currentStep;
  return stepMeta.find((step) => (run.steps?.[step.key]?.status || "todo") !== "done")?.key || "finalCheck";
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
    status: "queued_for_codex",
    currentStep: "yamix",
    message: "Queued for Codex pickup from this local web app.",
    worker: "codex_thread"
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
  return [
    `Project: ${run.projectName}`,
    `Site URL: ${run.siteUrl}`,
    `Google email: ${run.googleEmail}`,
    `Yamix market: ${run.captured.yamixExistingMarket || "read from existing Yamix project"}`,
    `Yamix language: ${run.captured.yamixExistingLanguage || "read from existing Yamix project"}`,
    `Automation status: ${statusLabel(automation.status)}`,
    `Current step: ${automation.currentStep || ""}`,
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
    `- Branded keywords: ${keywords.length ? keywords.join(", ") : "none"}`,
    `- Market/language source: existing Yamix project`,
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
  const status = blocked ? "needs_operator" : automation.status || stepStatus;
  const note = run.steps?.[step.key]?.note || "";

  els.stepCount.textContent = `Step ${currentStepNumber(run)}/${stepMeta.length}`;
  els.currentStepTitle.textContent = step.title;
  els.currentStepMessage.textContent = blocked
    ? automation.message || note || "Automation needs a person to complete the current browser step."
    : automation.message || note || step.text;

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
  els.runSubtitle.textContent = `${run.siteUrl} | Yamix market/language | ${run.googleEmail || "No Google email"}`;

  const progress = progressFor(run);
  els.progressText.textContent = `${progress.done}/${progress.total} completed`;
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
      status: "queued_for_codex",
      worker: "codex_thread",
      currentStep: "yamix",
      startedAt: timestamp,
      message: "Create Run received. This run is queued for Codex to perform the setup from the current chat."
    },
    credentials: {
      google: {
        email: String(raw.googleEmail || "").trim(),
        password: String(raw.googlePassword || ""),
        source: "run_form"
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
        message: "Run created and queued for Codex pickup."
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
  if (!String(raw.googleEmail || "").trim()) missing.push("Google email");
  if (!String(raw.googlePassword || "").trim()) missing.push("Gmail password");
  if (missing.length) {
    setFormError(`Required before start: ${missing.join(", ")}`);
    showToast("Missing required fields");
    els.form.querySelector("[name='siteUrl'], [name='googleEmail'], [name='googlePassword']")?.focus();
    return;
  }
  setFormError("");
  const payload = {
    siteUrl: raw.siteUrl,
    projectName: raw.projectName,
    googleEmail: raw.googleEmail,
    googlePassword: raw.googlePassword,
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
    ]
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
    ]
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

els.copyCodexCommand.addEventListener("click", async () => {
  const run = activeRun();
  if (!run) return;
  await navigator.clipboard.writeText(`Start queued setup run ${run.id}`);
  showToast("Codex pickup command copied");
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
