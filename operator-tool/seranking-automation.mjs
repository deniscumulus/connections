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

    // 1. Reuse an existing project for this domain. The sites list is paginated,
    // so page through it rather than checking only the first page.
    for (let page = 0; page < 12; page += 1) {
      const res = await fetch(
        `${SE_RANKING_API_BASE}/project-management/sites?limit=200&offset=${page * 200}`,
        { headers }
      );
      if (!res.ok) break;
      const data = await res.json().catch(() => null);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.sites) ? data.sites : [];
      if (!arr.length) break;
      const match = arr.find((s) => siteHost(s) === targetHost);
      if (match) {
        const id = match.id || match.site_id;
        return { success: true, seRankingProjectId: String(id), seRankingBacklinksReportId: String(id) };
      }
      if (arr.length < 200) break; // last page reached
    }

    // 2. Create it. Trust the id SE Ranking returns (per their API docs).
    const createRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: run.siteUrl, title: run.projectName })
    });
    const body = (await createRes.text().catch(() => "")).slice(0, 220);
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

    return { success: true, seRankingProjectId: String(id), seRankingBacklinksReportId: String(id) };
  } catch (error) {
    return { success: false, error: `SE Ranking API error: ${error.message}` };
  }
}
