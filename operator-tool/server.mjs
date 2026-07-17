import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const runsFile = path.join(dataDir, "runs.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const basicAuthUser = process.env.BASIC_AUTH_USER || "";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const defaultBigQueryProjectId = process.env.BIGQUERY_CLOUD_PROJECT_ID || "son-gcloud-452110-e8";
const defaultBigQueryDataLocation = process.env.BIGQUERY_DATA_LOCATION || "Frankfurt (europe-west3)";

// Server-side credentials (never exposed to client)
const credentials = {
  googleEmail: process.env.GOOGLE_EMAIL || "",
  googlePassword: process.env.GOOGLE_PASSWORD || "",
  managewpEmail: process.env.MANAGEWP_EMAIL || "",
  managewpPassword: process.env.MANAGEWP_PASSWORD || "",
  yamixEmail: process.env.YAMIX_EMAIL || "",
  yamixPassword: process.env.YAMIX_PASSWORD || "",
  seRankingEmail: process.env.SERANKING_EMAIL || "",
  seRankingPassword: process.env.SERANKING_PASSWORD || ""
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

await mkdir(dataDir, { recursive: true });
if (!existsSync(runsFile)) {
  await writeFile(runsFile, "[]\n", "utf8");
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function sendText(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function isAuthorized(req) {
  if (!basicAuthUser || !basicAuthPassword) return true;

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return safeEqual(user, basicAuthUser) && safeEqual(password, basicAuthPassword);
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;

  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Portfolio Setup Operator"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end("Authentication required");
  return false;
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data.trim()) return {};
  return JSON.parse(data);
}

async function readRuns() {
  const raw = await readFile(runsFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map((run) => applyDerived(run)) : [];
}

async function writeRuns(runs) {
  await writeFile(runsFile, `${JSON.stringify(runs, null, 2)}\n`, "utf8");
}

function normalizeUrl(value) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function domainFromUrl(value) {
  return new URL(value).hostname.toLowerCase();
}

function domainForDataset(hostname) {
  return hostname.replace(/^www\./, "");
}

function domainBaseForDataset(hostname) {
  const parts = domainForDataset(hostname).split(".").filter(Boolean);
  if (parts.length > 1) parts.pop();
  return parts.join(".");
}

function datasetFromDomain(hostname) {
  return `searchconsole_${domainBaseForDataset(hostname).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function gscBulkDestination(hostname, projectId = defaultBigQueryProjectId) {
  return `${projectId}.${datasetFromDomain(hostname)}`;
}

const brandTerms = [
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

function splitCompactBrand(value) {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = [];
  let index = 0;

  while (index < compact.length) {
    const term = brandTerms.find((item) => compact.startsWith(item, index));
    if (term) {
      words.push(term);
      index += term.length;
      continue;
    }

    let nextIndex = compact.length;
    for (let cursor = index + 1; cursor < compact.length; cursor += 1) {
      if (brandTerms.some((item) => compact.startsWith(item, cursor))) {
        nextIndex = cursor;
        break;
      }
    }
    words.push(compact.slice(index, nextIndex));
    index = nextIndex;
  }

  return words.filter(Boolean);
}

function parseKeywordInput(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueKeywords(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function brandedKeywords({ hostname, projectName, seRankingKeywords }) {
  const provided = parseKeywordInput(seRankingKeywords);
  if (provided.length) return uniqueKeywords(provided).slice(0, 10);

  const rawName = projectName || domainBaseForDataset(hostname);
  const withoutTld = rawName.includes(".") ? domainBaseForDataset(rawName) : rawName;
  const normalizedName = withoutTld.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compact = normalizedName.replace(/\s+/g, "");
  const words = normalizedName.includes(" ") ? normalizedName.split(/\s+/) : splitCompactBrand(compact);
  const spaced = words.join(" ").trim();
  const withoutAnd = spaced.replace(/\band\b/g, "").replace(/\s+/g, " ").trim();
  const ampersand = spaced.replace(/\band\b/g, "&").replace(/\s+/g, " ").trim();
  const withoutLeadingCasino = words[0] === "casino" ? words.slice(1).join(" ").trim() : "";

  return uniqueKeywords([
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

function defaultSteps() {
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

function isQueuedForCodex(run) {
  return ["queued_for_codex", "queued_for_worker", "waiting_for_worker"].includes(run.automation?.status) || (!run.automation && run.steps?.inputs?.status === "done");
}

function buildRun(input) {
  const siteUrl = normalizeUrl(input.siteUrl || input.domain || "");
  const hostname = domainFromUrl(siteUrl);
  const projectName = (input.projectName || domainForDataset(hostname)).trim();
  const bigQueryProjectId = (input.ga4BigQueryProjectId || "").trim() || defaultBigQueryProjectId;
  const now = new Date().toISOString();

  // Google email comes from form (per-run), password is from server env var
  const googleEmail = (input.googleEmail || "").trim();

  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    projectName,
    siteUrl,
    hostname,
    googleEmail,
    market: "",
    language: "",
    defaults: {
      yamixParentProject: "SKY Rocket",
      yamixRegexPattern: "",
      seRankingKeywords: brandedKeywords({ hostname, projectName, seRankingKeywords: input.seRankingKeywords }),
      seRankingCompetitors: "none"
    },
    generated: {
      gscDatasetName: datasetFromDomain(hostname),
      ga4DatasetName: "",
      yamixMainProjectUrl: siteUrl
    },
    captured: {
      ga4PropertyId: "",
      ga4MeasurementId: "",
      ga4WebStreamId: "",
      ga4BigQueryProjectId: bigQueryProjectId,
      bigQueryDatasetLocation: defaultBigQueryDataLocation,
      gscVerificationMetaTag: "",
      gscVerificationContent: "",
      gscBulkDataExportDestination: (input.gscBulkDataExportDestination || "").trim() || gscBulkDestination(hostname, bigQueryProjectId),
      gscBulkDataExportDatasetLocation: defaultBigQueryDataLocation,
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
    steps: defaultSteps()
  };
}

function applyDerived(run) {
  run.generated = run.generated || {};
  run.captured = {
    ga4BigQueryProjectId: defaultBigQueryProjectId,
    bigQueryDatasetLocation: defaultBigQueryDataLocation,
    gscBulkDataExportDestination: "",
    gscBulkDataExportDatasetLocation: defaultBigQueryDataLocation,
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
  const existingDefaults = run.defaults || {};
  run.defaults = {
    yamixParentProject: "SKY Rocket",
    yamixRegexPattern: "",
    seRankingKeywords: [],
    seRankingCompetitors: "none",
    ...existingDefaults
  };

  run.defaults.seRankingKeywords = brandedKeywords({
    hostname: run.hostname,
    projectName: run.projectName,
    seRankingKeywords: run.defaults.seRankingKeywords === "none" ? "" : run.defaults.seRankingKeywords
  });

  if (run.hostname) {
    run.generated.gscDatasetName = datasetFromDomain(run.hostname);
  }

  if (!run.captured.ga4BigQueryProjectId) {
    run.captured.ga4BigQueryProjectId = defaultBigQueryProjectId;
  }

  if (!run.captured.bigQueryDatasetLocation) {
    run.captured.bigQueryDatasetLocation = defaultBigQueryDataLocation;
  }

  if (!run.captured.gscBulkDataExportDestination && run.hostname) {
    run.captured.gscBulkDataExportDestination = gscBulkDestination(run.hostname, run.captured.ga4BigQueryProjectId);
  }

  if (!run.captured.gscBulkDataExportDatasetLocation) {
    run.captured.gscBulkDataExportDatasetLocation = defaultBigQueryDataLocation;
  }

  if (run.captured?.ga4PropertyId) {
    run.generated.ga4DatasetName = `analytics_${String(run.captured.ga4PropertyId).trim()}`;
  }

  if (run.captured?.gscVerificationMetaTag) {
    const match = run.captured.gscVerificationMetaTag.match(/content=["']([^"']+)["']/i);
    if (match && !run.captured.gscVerificationContent) {
      run.captured.gscVerificationContent = match[1];
    }
  }

  return run;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/runs") {
    const runs = await readRuns();
    sendJson(res, 200, runs);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runs/next-queued") {
    const runs = await readRuns();
    const run = runs.find((item) => isQueuedForCodex(item));
    sendJson(res, 200, run || null);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    const body = await readBody(req);
    if (!body.siteUrl && !body.domain) {
      sendJson(res, 400, { error: "siteUrl or domain is required" });
      return;
    }
    const run = buildRun(body);
    const runs = await readRuns();
    runs.unshift(run);
    await writeRuns(runs);
    sendJson(res, 201, run);
    return;
  }

  if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
    const runs = await readRuns();
    const index = runs.findIndex((run) => run.id === parts[2]);
    if (index === -1) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);
      const next = applyDerived({
        ...runs[index],
        ...body,
        generated: { ...runs[index].generated, ...(body.generated || {}) },
        captured: { ...runs[index].captured, ...(body.captured || {}) },
        confirmations: { ...runs[index].confirmations, ...(body.confirmations || {}) },
        steps: { ...runs[index].steps, ...(body.steps || {}) },
        updatedAt: new Date().toISOString()
      });
      runs[index] = next;
      await writeRuns(runs);
      sendJson(res, 200, next);
      return;
    }

    if (req.method === "POST" && parts[3] === "claim") {
      const now = new Date().toISOString();
      const next = applyDerived({
        ...runs[index],
        automation: {
          ...(runs[index].automation || {}),
          status: "running",
          worker: "codex_thread",
          claimedAt: now,
          message: "Codex claimed this run and started setup."
        },
        logs: [
          ...(Array.isArray(runs[index].logs) ? runs[index].logs : []),
          { at: now, level: "info", message: "Run claimed by Codex." }
        ],
        updatedAt: now
      });
      runs[index] = next;
      await writeRuns(runs);
      sendJson(res, 200, next);
      return;
    }

    if (req.method === "DELETE") {
      const [removed] = runs.splice(index, 1);
      await writeRuns(runs);
      sendJson(res, 200, removed);
      return;
    }
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (!requireAuth(req, res)) return;
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Portfolio setup operator running at http://${host}:${port}`);
});
