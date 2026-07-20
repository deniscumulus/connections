// SE Ranking via the official Project API (no browser, no reCAPTCHA).
// Docs: https://seranking.com/api/project/project-management/
// Auth: Authorization: Token <API key>. Creating a project uses the plan's
// project limits, not API credits.
const SE_RANKING_API_BASE = "https://api.seranking.com/v1";

function normalizeHost(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// Creates (or reuses) the SE Ranking project for the run's domain and returns
// the site_id, which is the SE Ranking Project ID. The backlink monitor is keyed
// by the same site_id, so we use it for the Backlinks Report ID too.
// NOTE: verify against Yamix whether "Backlinks Report ID" is a separate value.
export async function setupSERanking(run, apiKey) {
  try {
    if (!apiKey) {
      return {
        success: false,
        needsOperator: true,
        error: "SE Ranking API key not configured (SERANKING_API_KEY)."
      };
    }

    const headers = {
      authorization: `Token ${apiKey}`,
      "content-type": "application/json"
    };
    const targetHost = normalizeHost(run.hostname || run.siteUrl);

    // 1. Reuse an existing project for this domain if it already exists.
    let siteId = null;
    const listRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, { headers });
    if (listRes.ok) {
      const sites = await listRes.json();
      if (Array.isArray(sites)) {
        const match = sites.find(
          (site) => normalizeHost(site.name || site.domain || site.url) === targetHost
        );
        if (match) siteId = match.id || match.site_id;
      }
    }

    // 2. Otherwise create it.
    if (!siteId) {
      const createRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: run.siteUrl, title: run.projectName })
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => "");
        return { success: false, error: `SE Ranking create failed: ${createRes.status} ${text}`.trim() };
      }
      const created = await createRes.json();
      siteId = created.site_id || created.id;
    }

    if (!siteId) {
      return { success: false, error: "SE Ranking: could not determine site_id from the API response." };
    }

    return {
      success: true,
      seRankingProjectId: String(siteId),
      seRankingBacklinksReportId: String(siteId)
    };
  } catch (error) {
    return { success: false, error: `SE Ranking API error: ${error.message}` };
  }
}
