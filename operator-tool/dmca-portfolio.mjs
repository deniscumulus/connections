// Adds every onboarded site to the DMCA claims tool's portfolio
// (https://dmca.bestonlinecasinodownload.com), so a site set up here is
// monitored for copyright claims without anyone re-typing the domain.
//
// The DMCA app exposes POST /api/domains {domain} and sits behind Basic Auth.
// Its portfolio uses BARE domains (its own Lumen scanner strips "www."), so we
// normalize before sending to avoid near-duplicate entries.

function bareDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return raw.replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

export async function addDomainToDmcaPortfolio(siteUrlOrHost, config = {}) {
  const { baseUrl, user, password } = config;
  const domain = bareDomain(siteUrlOrHost);

  if (!domain) return { ok: false, skipped: true, message: "No domain to add." };
  if (!baseUrl) {
    return {
      ok: false,
      skipped: true,
      message: "DMCA portfolio sync is off (DMCA_BASE_URL not configured)."
    };
  }

  const headers = { "content-type": "application/json" };
  if (user && password) {
    headers.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }

  let response;
  try {
    response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/api/domains`, {
      method: "POST",
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    return { ok: false, domain, message: `Could not reach the DMCA tool: ${error.message}` };
  }

  if (response.status === 401) {
    return { ok: false, domain, message: "DMCA tool rejected the login (401) — check DMCA_USER / DMCA_PASSWORD." };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      domain,
      message: `DMCA tool returned ${response.status}. ${String(body).replace(/\s+/g, " ").slice(0, 160)}`.trim()
    };
  }

  // Confirm against the returned portfolio rather than trusting the 200 — the
  // same read-back rule the Yamix/SE Ranking automations learned the hard way.
  const payload = await response.json().catch(() => null);
  const domains = payload?.portfolio?.domains;
  if (Array.isArray(domains) && !domains.includes(domain)) {
    return { ok: false, domain, message: `DMCA tool accepted the request but "${domain}" is not in the portfolio.` };
  }

  // Adding a domain that's already there is a no-op on their side (the portfolio
  // is a de-duplicated set), so a re-run is safe.
  return { ok: true, domain, message: `Added "${domain}" to the DMCA portfolio.` };
}
