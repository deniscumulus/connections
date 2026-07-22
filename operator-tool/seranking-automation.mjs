// SE Ranking via the official Project API (no browser, no reCAPTCHA).
// Docs: https://seranking.com/api/project/project-management/
// Auth: Authorization: Token <API key>. POST /project-management/sites needs only
// { url, title } and returns 201 + the project id (authoritative).
const SE_RANKING_API_BASE = "https://api.seranking.com/v1";

function normalizeHost(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function siteHost(s) {
  return normalizeHost(s?.name || s?.domain || s?.url || s?.site);
}

// Creates (or reuses) the SE Ranking project for the run's domain and returns its
// site_id (also used for the Backlinks Report ID — same key).
export async function setupSERanking(run, apiKey) {
  try {
    if (!apiKey) {
      return { success: false, needsOperator: true, error: "SE Ranking API key not configured (SERANKING_API_KEY)." };
    }

    const headers = { authorization: `Token ${apiKey}`, "content-type": "application/json" };
    const targetHost = normalizeHost(run.hostname || run.siteUrl);

    // Fetch the whole sites list in one call (limit=1000 covers the account)
    // so we can both reuse and later verify without pagination guesswork.
    async function listSites() {
      const res = await fetch(`${SE_RANKING_API_BASE}/project-management/sites?limit=1000`, { headers });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      return Array.isArray(data) ? data : Array.isArray(data?.sites) ? data.sites : [];
    }

    // 1. Reuse an existing project for this domain.
    const before = await listSites();
    const existing = before.find((s) => siteHost(s) === targetHost);
    if (existing) {
      const id = String(existing.id || existing.site_id);
      return {
        success: true,
        seRankingProjectId: id,
        seRankingBacklinksReportId: id,
        detail: `Reused existing SE Ranking project (site_id ${id}).`
      };
    }

    // 2. Create it. Ask for an ACTIVE site (is_active=0 creates a "delayed" site
    // that may not show up in the account).
    const createRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: run.siteUrl, title: run.projectName, is_active: 1 })
    });
    const body = (await createRes.text().catch(() => "")).slice(0, 240);
    if (!createRes.ok) {
      return { success: false, needsOperator: true, error: `SE Ranking create failed: ${createRes.status} ${body}`.trim() };
    }

    let created = {};
    try {
      created = JSON.parse(body);
    } catch {
      /* leave empty */
    }
    const id = created.site_id || created.id;
    if (!id) {
      return { success: false, needsOperator: true, error: `SE Ranking create returned no site_id. Response: ${body}` };
    }

    // 3. Verify the project actually appears in the account. A returned site_id
    // is not proof — re-list and confirm by host or id. If it's missing, stop
    // honestly instead of passing a phantom id downstream to Yamix.
    let verified = false;
    for (let i = 0; i < 3 && !verified; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const after = await listSites();
      verified = after.some(
        (s) => siteHost(s) === targetHost || String(s.id || s.site_id) === String(id)
      );
    }

    if (!verified) {
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking returned site_id ${id} but the project for ${targetHost} does not appear in your SE Ranking sites list — it likely was not really created. Create-response: ${body}`
      };
    }

    return {
      success: true,
      seRankingProjectId: String(id),
      seRankingBacklinksReportId: String(id),
      detail: `Created SE Ranking project (site_id ${id}) and verified it in the account.`
    };
  } catch (error) {
    return { success: false, error: `SE Ranking API error: ${error.message}` };
  }
}
