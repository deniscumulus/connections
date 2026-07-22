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

// Pick the Google search engines matching the run's market — both the desktop
// ("Google United Kingdom") and mobile ("Google Mobile United Kingdom") entries,
// like the manual wizard adds. Each engine is { id, name, regionid }. Excludes
// Maps/Images/News/etc.
function pickGoogleEngines(engines, market) {
  const EXCLUDE = /maps|image|news|shopping|youtube|video|local/i;
  const google = engines.filter(
    (e) => /^google\b/i.test(String(e?.name || "").trim()) && !EXCLUDE.test(String(e?.name || ""))
  );
  for (const keyword of MARKET_ENGINE_COUNTRY[market] || []) {
    const matches = google.filter((e) => String(e.name || "").toLowerCase().includes(keyword));
    if (matches.length) return matches; // desktop + mobile for this country
  }
  return [];
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

    // Find the target group. Grouped sites (group_id != 0) show in the dashboard;
    // ungrouped (group_id 0) do NOT — that's the difference between visible real
    // projects (StreetRocket) and our created ones. Endpoint verified:
    // GET /project-management/sites/groups -> [{id,name}] (StreetRocket = 35083).
    const GROUP_NAME = run.defaults?.seRankingGroup || "StreetRocket";
    let siteGroupId = null;
    let groupDetail = "";
    try {
      const gRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites/groups`, { headers });
      if (gRes.ok) {
        const groups = await gRes.json().catch(() => []);
        const arr = Array.isArray(groups) ? groups : groups?.groups || [];
        const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
        const match = arr.find((x) => norm(x.name) === norm(GROUP_NAME));
        if (match) siteGroupId = match.id;
        else groupDetail = `group "${GROUP_NAME}" not found`;
      } else {
        groupDetail = `groups list failed: ${gRes.status}`;
      }
    } catch (e) {
      groupDetail = `groups error: ${e.message}`;
    }

    // 2. Create it. ACTIVE + subdomain_match:1 (the wizard's recommended
    // "*.domain/*" domain type -> match_mode "subdomain"). This is what makes it
    // a visible dashboard project: API-created sites default to match_mode
    // "domain", which does NOT surface in the dashboard, while subdomain/path
    // projects do (proven by comparing a manually-created visible project).
    const createPayload = { url: run.siteUrl, title: run.projectName, is_active: 1, subdomain_match: 1 };
    if (siteGroupId != null) createPayload.site_group_id = Number(siteGroupId);
    const createRes = await fetch(`${SE_RANKING_API_BASE}/project-management/sites`, {
      method: "POST",
      headers,
      body: JSON.stringify(createPayload)
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

    // 3. Add Google search engines (desktop + mobile) for the market — like the
    // wizard's step 2. A bare url+title site doesn't surface in the Projects UI;
    // engines + keywords make it a real tracked project. Collect each engine's
    // site_engine_id (returned by the add call) to attach keywords to them.
    let engineDetail = "no search engine added";
    let engineAdded = false;
    const siteEngineIds = [];
    try {
      const seRes = await fetch(`${SE_RANKING_API_BASE}/project-management/system/search-engines`, { headers });
      if (seRes.ok) {
        const list = await seRes.json().catch(() => []);
        const engineList = pickGoogleEngines(Array.isArray(list) ? list : list?.search_engines || [], run.market);
        if (engineList.length) {
          const added = [];
          let lastErr = "";
          for (const engine of engineList) {
            // site_id goes in the QUERY STRING (not the body) per the API.
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
              added.push(engine.name);
              try {
                const parsed = JSON.parse(addBody);
                const seid = parsed.site_engine_id || parsed.id;
                if (seid) siteEngineIds.push(Number(seid));
              } catch {
                /* leave */
              }
            } else {
              lastErr = `${addRes.status} ${addBody.slice(0, 120)}`;
            }
          }
          engineDetail = engineAdded
            ? `added engines: ${added.join(", ")}`
            : `engine add failed: ${lastErr}`;
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
          siteEngineIds.length ? { keyword, site_engine_ids: siteEngineIds } : { keyword }
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

    // 3c. Trigger a position recheck to kick off the project's first data check.
    // API-created projects stay hidden from the dashboard until their keywords
    // are first checked (they come in with first_check_date null). The recheck
    // body needs each keyword's id + its site_engine_ids, so fetch the keywords
    // first and build the list. Proven working (returns {"total":N}).
    let recheckDetail = "";
    try {
      const kwListRes = await fetch(`${SE_RANKING_API_BASE}/project-management/keywords?site_id=${Number(id)}`, { headers });
      if (kwListRes.ok) {
        const kwList = await kwListRes.json().catch(() => []);
        const arr = Array.isArray(kwList) ? kwList : kwList?.keywords || [];
        const recheckBody = [];
        for (const kw of arr) {
          for (const seid of kw.site_engine_ids || []) {
            recheckBody.push({ site_engine_id: Number(seid), keyword_id: Number(kw.id) });
          }
        }
        if (recheckBody.length) {
          const rRes = await fetch(
            `${SE_RANKING_API_BASE}/project-management/sites/positions/recheck?site_id=${Number(id)}`,
            { method: "POST", headers, body: JSON.stringify(recheckBody) }
          );
          const rBody = (await rRes.text().catch(() => "")).slice(0, 120);
          recheckDetail = rRes.ok ? `recheck triggered ${rBody}` : `recheck failed: ${rRes.status} ${rBody}`;
        } else {
          recheckDetail = "no keywords to recheck";
        }
      } else {
        recheckDetail = `keyword list failed: ${kwListRes.status}`;
      }
    } catch (e) {
      recheckDetail = `recheck error: ${e.message}`;
    }

    // 4. Verify the project actually appears in the account. A returned site_id
    // is not proof — re-list and confirm by host or id. If it's missing, stop
    // honestly instead of passing a phantom id downstream to Yamix.
    let verified = false;
    let after = [];
    let createdSite = null;
    for (let i = 0; i < 3 && !verified; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      after = await listSites();
      createdSite = after.find(
        (s) => siteHost(s) === targetHost || String(s.id || s.site_id) === String(id)
      );
      verified = Boolean(createdSite);
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

    // Did the group actually stick? Grouped (group_id != 0) = visible in the
    // dashboard; still 0 means the create ignored site_group_id (locked group)
    // and we need a separate move call.
    const actualGroup = createdSite.group_id;
    const groupNote = siteGroupId
      ? actualGroup && String(actualGroup) !== "0"
        ? `in group ${actualGroup}`
        : `GROUP NOT APPLIED (still group_id ${actualGroup}; wanted ${siteGroupId})`
      : groupDetail || "no group";

    return {
      success: true,
      seRankingProjectId: String(id),
      seRankingBacklinksReportId: String(id),
      detail: `Created SE Ranking project (site_id ${id}), ${groupNote}, ${engineDetail}, ${keywordDetail}, ${recheckDetail}, verified.`
    };
  } catch (error) {
    return { success: false, error: `SE Ranking API error: ${error.message}` };
  }
}
