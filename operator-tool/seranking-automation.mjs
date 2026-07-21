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

// Creates (or reuses) the SE Ranking project for the run's domain, then VERIFIES
// it exists in the sites list and returns that list id (authoritative). The
// backlink monitor is keyed by the same site_id.
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

    // Finds the site row for this domain in the sites list (the authoritative id).
    async function findSite() {
      const res = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, { headers });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.sites) ? data.sites : [];
      return (
        arr.find((s) => normalizeHost(s.name || s.domain || s.url || s.site) === targetHost) || null
      );
    }

    // 1. Reuse if a project for this domain already exists.
    let site = await findSite();

    // 2. Otherwise create it.
    let createInfo = "";
    if (!site) {
      const createRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: run.siteUrl, title: run.projectName })
      });
      createInfo = `${createRes.status} ${(await createRes.text().catch(() => "")).slice(0, 160)}`.trim();
      if (!createRes.ok) {
        return { success: false, needsOperator: true, error: `SE Ranking create failed: ${createInfo}` };
      }
      // Confirm it actually landed in the sites list (retry, the API can lag).
      for (let i = 0; i < 4 && !site; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        site = await findSite();
      }
    }

    if (!site) {
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking accepted the create but no project for ${targetHost} appears in the sites list (create: ${createInfo || "n/a"}). Nothing usable was captured.`
      };
    }

    const siteId = site.id || site.site_id;
    if (!siteId) {
      return { success: false, needsOperator: true, error: "SE Ranking: found the site but it has no id in the list response." };
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
