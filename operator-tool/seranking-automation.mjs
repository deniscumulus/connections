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

// Market code -> country keywords as they appear in SE Ranking engine names
// (e.g. "Google United Kingdom", "Google USA"). Multiple keywords give a
// fallback if SE Ranking's label differs slightly.
const MARKET_ENGINE_COUNTRY = {
  GB: ["united kingdom", "uk"],
  US: ["usa", "united states"],
  CA: ["canada"],
  AU: ["australia"],
  NZ: ["new zealand"],
  IE: ["ireland"],
  DE: ["germany"],
  BR: ["brazil", "brasil"],
  NL: ["netherlands"],
  FI: ["finland"],
  FR: ["france"],
  DK: ["denmark"],
  ES: ["spain"],
  SV: ["sweden"],
  CL: ["chile"]
};

// Pick the Google search engine matching the run's market from the account's
// engine list (each is { id, name, regionid }).
function pickGoogleEngine(engines, market) {
  const google = engines.filter((e) => /google/i.test(e?.name || ""));
  for (const keyword of MARKET_ENGINE_COUNTRY[market] || []) {
    const match = google.find((e) => (e.name || "").toLowerCase().includes(keyword));
    if (match) return match;
  }
  return null;
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

    // 3. Add a Google search engine for the market. A bare url+title site does
    // not surface in the Projects UI; adding an engine makes it a real tracked
    // project. If this fails, we stop with the reason (below) so it's visible.
    let engineDetail = "no search engine added";
    let engineAdded = false;
    let siteEngineId = null;
    try {
      const seRes = await fetch(`${SE_RANKING_API_BASE}/project-management/system/search-engines`, { headers });
      if (seRes.ok) {
        const list = await seRes.json().catch(() => []);
        const engine = pickGoogleEngine(Array.isArray(list) ? list : list?.search_engines || [], run.market);
        if (engine) {
          // site_id goes in the QUERY STRING (not the body) per the API — sending
          // it in the body made the endpoint reject with a bogus "Project name"
          // 400. Body carries the engine + a country-level region (0).
          const addRes = await fetch(
            `${SE_RANKING_API_BASE}/project-management/sites/search-engines?site_id=${Number(id)}`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ search_engine_id: Number(engine.id), region_id: 0 })
            }
          );
          const addBody = await addRes.text().catch(() => "");
          if (addRes.ok) {
            engineAdded = true;
            // The response returns site_engine_id — the project-local engine id
            // needed to attach keywords to this engine.
            try {
              const parsed = JSON.parse(addBody);
              siteEngineId = parsed.site_engine_id || parsed.id || null;
            } catch {
              /* leave null */
            }
            engineDetail = `added engine "${engine.name}"`;
          } else {
            engineDetail = `engine add failed: ${addRes.status} ${addBody.slice(0, 160)}`;
          }
        } else {
          engineDetail = `no Google engine matched market "${run.market}"`;
        }
      } else {
        engineDetail = `engine list failed: ${seRes.status} ${(await seRes.text().catch(() => "")).slice(0, 120)}`;
      }
    } catch (e) {
      engineDetail = `engine error: ${e.message}`;
    }

    if (!engineAdded) {
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking site created (site_id ${id}) but adding the search engine failed, so it won't show as a project. Reason: ${engineDetail}`
      };
    }

    // 3b. Add keywords so the site becomes a real, visible tracked project
    // (sites with keyword_count 0 don't surface in the Projects list). Keywords
    // come from the form's branded-keywords field, or are auto-derived
    // (run.seRankingKeywords / run.defaults.seRankingKeywords, already computed).
    let keywordDetail = "no keywords added";
    const rawKeywords = (run.seRankingKeywords && run.seRankingKeywords.length
      ? run.seRankingKeywords
      : run.defaults?.seRankingKeywords) || [];
    const keywords = (Array.isArray(rawKeywords) ? rawKeywords : [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 10);
    if (keywords.length) {
      try {
        const kwBody = keywords.map((keyword) =>
          siteEngineId ? { keyword, site_engine_ids: [Number(siteEngineId)] } : { keyword }
        );
        const kwRes = await fetch(`${SE_RANKING_API_BASE}/project-management/keywords?site_id=${Number(id)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(kwBody)
        });
        keywordDetail = kwRes.ok
          ? `added ${keywords.length} keywords`
          : `keywords failed: ${kwRes.status} ${(await kwRes.text().catch(() => "")).slice(0, 140)}`;
      } catch (e) {
        keywordDetail = `keywords error: ${e.message}`;
      }
    }

    // 4. Verify the project actually appears in the account. A returned site_id
    // is not proof — re-list and confirm by host or id. If it's missing, stop
    // honestly instead of passing a phantom id downstream to Yamix.
    let verified = false;
    let after = [];
    for (let i = 0; i < 3 && !verified; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      after = await listSites();
      verified = after.some(
        (s) => siteHost(s) === targetHost || String(s.id || s.site_id) === String(id)
      );
    }
    const sampleHosts = after.slice(0, 4).map(siteHost).filter(Boolean).join(", ");
    const accountInfo = `API account sees ${after.length} sites (e.g. ${sampleHosts})`;

    if (!verified) {
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking returned site_id ${id} but the project for ${targetHost} does not appear in your SE Ranking sites list — it likely was not really created. ${accountInfo}. Create-response: ${body}`
      };
    }

    return {
      success: true,
      seRankingProjectId: String(id),
      seRankingBacklinksReportId: String(id),
      detail: `Created SE Ranking project (site_id ${id}), ${engineDetail}, ${keywordDetail}, verified.`
    };
  } catch (error) {
    return { success: false, error: `SE Ranking API error: ${error.message}` };
  }
}
