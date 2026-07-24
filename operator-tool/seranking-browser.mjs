// SE Ranking project creation via the BROWSER wizard (Plan B).
// The public Project Management API creates "sites" that never surface in the
// dashboard on this (agency) account — proven exhaustively. The manual wizard
// (admin.site.wizard.html) uses an internal path that DOES produce a visible,
// active dashboard project. So we drive that wizard with Playwright, exactly
// like the Yamix automation. SE Ranking login is a normal login (no Google wall).
//
// Built from Denis's wizard screenshots (2026-07-22): 6 steps — General info,
// Search engines, Keywords, Prompts (skip), Competitors (skip), Statistics (skip).
// UNVERIFIED DOM: selectors are best-effort; expect a few test-and-fix rounds.
//
// playwright is imported lazily inside the function so a module-load issue can
// never crash the worker on startup (which would leave runs stuck "queued").

// Market code -> the country label shown in the wizard's Country dropdown.
const MARKET_COUNTRY = {
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  IE: "Ireland",
  DE: "Germany",
  BR: "Brazil",
  NL: "Netherlands",
  FI: "Finland",
  FR: "France",
  DK: "Denmark",
  ES: "Spain",
  SV: "Sweden",
  CL: "Chile"
};

// Returns whether the click actually landed — a covered/intercepted click must
// not report success (that hid the location-button failure for several rounds).
async function clickButtonByText(page, re, { timeout = 8000, force = false } = {}) {
  const btn = page.getByRole("button", { name: re }).first();
  if (!(await btn.count().catch(() => 0))) return false;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await btn.click({ timeout, force });
    return true;
  } catch {
    return false;
  }
}

// Turn on "Advanced settings" — that switches the wizard from the quick
// single-page form (whose Location autocomplete never commits a pick) to the
// multi-step flow, where Country is an ordinary dropdown.
async function toggleAdvanced(page) {
  const sw = page.getByRole("switch", { name: /advanced/i }).first();
  if (await sw.count().catch(() => 0)) {
    const checked = await sw.getAttribute("aria-checked").catch(() => null);
    if (checked !== "true") await sw.click({ timeout: 5000 }).catch(() => {});
    return "switch";
  }
  const label = page.getByText(/advanced settings/i).first();
  if (await label.count().catch(() => 0)) {
    await label.click({ timeout: 5000 }).catch(() => {});
    return "label";
  }
  return "not-found";
}

// Country in advanced mode: try a native <select> first, then a custom dropdown.
async function selectCountryAdvanced(page, country) {
  const selects = page.locator("select");
  const n = await selects.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    try {
      await selects.nth(i).selectOption({ label: country }, { timeout: 3000 });
      return "select";
    } catch {
      /* not this one */
    }
  }
  const re = new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const trigger = page
    .locator('[role="combobox"], [class*="select-trigger" i], [class*="select" i], button')
    .filter({ hasText: /country|united states|choose|select/i })
    .first();
  if (await trigger.count().catch(() => 0)) {
    await trigger.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const opt = page.locator('.ui-option, [role="option"], li').filter({ hasText: re }).first();
    if (await opt.count().catch(() => 0)) {
      await opt.click({ timeout: 5000 }).catch(() => {});
      return "custom";
    }
    return "opened-no-option";
  }
  return "no-trigger";
}

// Snapshot of the current wizard step for diagnostics when something fails.
async function snapshot(page) {
  return page
    .evaluate(() => {
      const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
      const heading = clip(document.querySelector("h1,h2,h3")?.textContent, 40);
      // Skip checkboxes/radios — there are ~15 of them and they were flooding
      // the list, truncating the real text fields (incl. the location input).
      const inputs = [...document.querySelectorAll("input,textarea")]
        .filter((el) => !["hidden", "checkbox", "radio"].includes(el.type))
        .map((el) => `${clip(el.placeholder || el.name || el.getAttribute("aria-label") || el.id || "in", 22)}=${clip(el.value, 22) || "∅"}`)
        .slice(0, 20);
      const buttons = [...document.querySelectorAll("button")]
        .map((b) => clip(b.textContent, 20))
        .filter(Boolean)
        .slice(0, 20);
      // Error / captcha signals: alert-ish text and any reCAPTCHA iframe.
      const errText = [...document.querySelectorAll('[role="alert"], .error, [class*="error" i], [class*="invalid" i], .notification, .toast')]
        .map((el) => clip(el.textContent, 60))
        .filter(Boolean)
        .slice(0, 4);
      const captchaFrames = [...document.querySelectorAll("iframe")]
        .filter((f) => /recaptcha|captcha|hcaptcha/i.test(f.src || ""))
        .map((f) => (f.getBoundingClientRect().width > 0 ? "visible-captcha" : "hidden-captcha"));
      // Any open dropdown/listbox/dialog — tells us if a picker actually opened.
      const popups = [...document.querySelectorAll('[role="listbox"], [role="dialog"], [role="menu"], [class*="dropdown" i], [class*="popup" i], [class*="suggest" i], ul, [class*="list" i]')]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => clip(el.textContent, 50))
        .filter(Boolean)
        .slice(0, 3);
      return JSON.stringify({ url: location.href.slice(0, 80), heading, inputs, buttons, errors: errText, captcha: captchaFrames, popups });
    })
    .catch(() => "");
}

function extractSiteId(url) {
  const m = String(url || "").match(/site_id=(\d+)/);
  return m ? m[1] : null;
}

// Normalize a cookie export (e.g. Cookie-Editor JSON) into Playwright's format.
// Cookie-Editor uses expirationDate + lowercase sameSite; Playwright wants
// expires + Strict/Lax/None, and rejects unknown fields.
function normalizeCookies(raw) {
  const arr = Array.isArray(raw) ? raw : raw?.cookies || [];
  const sameSiteOf = (v) => {
    const s = String(v || "").toLowerCase();
    if (s.includes("none") || s === "no_restriction") return "None";
    if (s.includes("strict")) return "Strict";
    return "Lax";
  };
  return arr
    .filter((c) => c && c.name && c.value && (c.domain || c.url))
    .map((c) => {
      const cookie = {
        name: String(c.name),
        value: String(c.value),
        path: c.path || "/",
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: sameSiteOf(c.sameSite)
      };
      if (c.domain) cookie.domain = String(c.domain);
      else cookie.url = String(c.url);
      const exp = c.expires ?? c.expirationDate;
      if (typeof exp === "number" && exp > 0) cookie.expires = Math.floor(exp);
      return cookie;
    });
}

// Creates a visible SE Ranking project through the dashboard wizard.
// auth: { cookiesJson } (preferred) or { email, password }.
export async function setupSERankingBrowser(run, auth = {}) {
  const { cookiesJson = "", email = "", password = "" } = auth;
  let browser;
  try {
    if (!cookiesJson && !(email && password)) {
      return {
        success: false,
        needsOperator: true,
        error: "SE Ranking browser auth not configured (set SERANKING_COOKIES_B64, or SERANKING_EMAIL + password)."
      };
    }

    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    const context = await browser.newContext();

    // Preferred: reuse Denis's logged-in SUB-ACCOUNT session (cookies). Two
    // reasons this is the only workable path: SE Ranking's login page has a
    // VISIBLE reCAPTCHA that blocks automated login, and projects created with
    // the admin's API key land in the admin account and can't be moved to a
    // sub-account (confirmed by SE Ranking support). Running as his session
    // creates the project inside his sub-account, where he can see it.
    let usedSession = false;
    if (cookiesJson) {
      try {
        const cookies = normalizeCookies(JSON.parse(cookiesJson));
        if (cookies.length) {
          await context.addCookies(cookies);
          usedSession = true;
        }
      } catch (e) {
        return { success: false, needsOperator: true, error: `SE Ranking session cookies could not be parsed: ${e.message}` };
      }
    }

    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    // Record failed responses — the location suggestions come from an XHR, and
    // if that call errors in the automated browser the list never renders even
    // though the typed text is in the box (exactly what we're seeing).
    const failedRequests = [];
    // The location suggestions come from api.se.googleplaces.html?do=AllPlaces&
    // query=... (fires per keystroke, 200). Log it regardless of status so we can
    // tell "the search never ran" from "it ran and my click missed the list".
    const placesRequests = [];
    page.on("response", (resp) => {
      try {
        const url = resp.url();
        if (/googleplaces/i.test(url)) {
          placesRequests.push(`${resp.status()} ${(url.split("?")[1] || "").slice(0, 60)}`);
        }
        if (resp.status() >= 400) {
          failedRequests.push(`${resp.status()} ${url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70)}`);
        }
      } catch {
        /* ignore */
      }
    });

    // 1. Login (only when no session cookies — expect reCAPTCHA to block this).
    if (!usedSession) {
    await page.goto("https://online.seranking.com/login.html");
    await page.waitForLoadState().catch(() => {});
    // SE Ranking login fields are named altem[login] / altem[password]; match by
    // "login"/"password" substrings to be robust. NOTE: the page also has a
    // g-recaptcha-response field — if reCAPTCHA challenges, automated login is
    // blocked (same wall as Google).
    const emailField = page.locator('input[name*="login" i], input[type="email"], input[name="email"]').first();
    await emailField.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    const pwField = page.locator('input[name*="password" i], input[type="password"]').first();
    await emailField.click().catch(() => {});
    await emailField.pressSequentially(email, { delay: 25 }).catch(() => {});
    await pwField.click().catch(() => {});
    await pwField.pressSequentially(password, { delay: 25 }).catch(() => {});
    await clickButtonByText(page, /log ?in|sign ?in|войти/i);
    await pwField.press("Enter").catch(() => {});

    // Confirm login (password field goes away / we leave the login page).
    let loggedIn = false;
    for (let i = 0; i < 24; i += 1) {
      if (!/login\.html/i.test(page.url())) {
        loggedIn = true;
        break;
      }
      const pwGone = await pwField.isVisible().then((v) => !v).catch(() => true);
      if (pwGone && !/login\.html/i.test(page.url())) {
        loggedIn = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!loggedIn) {
      const snap = await snapshot(page);
      return { success: false, needsOperator: true, error: `SE Ranking login did not complete. [email:${email ? "set" : "empty"}, pwLen:${(password || "").length}] ${snap}` };
    }
    }

    // 2. Open the create-project wizard.
    await page.goto("https://online.seranking.com/admin.site.wizard.html#/");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Bounced back to the login page = the session isn't valid.
    if (/login\.html/i.test(page.url())) {
      return {
        success: false,
        needsOperator: true,
        error: usedSession
          ? "SE Ranking session expired or invalid — log in manually with 'keep me logged in', re-export the cookies for online.seranking.com, and update the SERANKING_COOKIES_B64 secret."
          : "SE Ranking login blocked (reCAPTCHA) — use session cookies instead."
      };
    }
    // ---- ADVANCED mode ----
    // The quick single-page form's Location is an autocomplete that never
    // commits a pick (typing works, list renders, click runs clean — the
    // component just ignores it; ~10 approaches tried). Advanced settings opens
    // the multi-step wizard where Country is a plain dropdown instead.
    const stepDiags = [`advanced:${await toggleAdvanced(page)}`];
    await page.waitForTimeout(2000);

    // ---- Step 1: General information ----
    const urlField = page.getByPlaceholder(/website url|enter domain or url|url/i).first();
    await urlField.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await urlField.click().catch(() => {});
    await urlField.fill(run.siteUrl).catch(() => {});
    const nameField = page.getByPlaceholder(/project name/i).first();
    if (await nameField.count().catch(() => 0)) {
      await nameField.click().catch(() => {});
      await nameField.fill(run.projectName || run.siteUrl).catch(() => {});
    }
    await page.waitForTimeout(800);
    stepDiags.push(`s1next:${await clickButtonByText(page, /next step|next|continue/i)}`);
    await page.waitForTimeout(3000);
    // Step 1 creates the site and puts its id in the wizard URL.
    let siteId = extractSiteId(page.url());
    stepDiags.push(`siteId:${siteId || "-"}`);

    // ---- Step 2: Search engines (Country is a normal dropdown in this mode) ----
    const country = MARKET_COUNTRY[run.market] || "United Kingdom";
    stepDiags.push(`country:${await selectCountryAdvanced(page, country)}`);
    await page.waitForTimeout(800);
    stepDiags.push(`addEngine:${await clickButtonByText(page, /add search engine/i)}`);
    await page.waitForTimeout(2000);
    stepDiags.push(`s2next:${await clickButtonByText(page, /next step|next|continue/i)}`);
    await page.waitForTimeout(2500);

    // ---- Step 3: Keywords ----
    const keywords = (run.defaults?.seRankingKeywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 10);
    if (keywords.length) {
      const kwBox = page.locator("textarea").first();
      if (await kwBox.count().catch(() => 0)) {
        await kwBox.click().catch(() => {});
        await kwBox.fill(keywords.join("\n")).catch(() => {});
        await page.waitForTimeout(800);
        stepDiags.push(`addKw:${await clickButtonByText(page, /add keywords/i)}`);
        await page.waitForTimeout(1500);
      }
    }
    stepDiags.push(`s3next:${await clickButtonByText(page, /next step|next|continue/i)}`);
    await page.waitForTimeout(2000);

    // ---- Steps 4 & 5: Prompts / Competitors — skipped ----
    stepDiags.push(`s4next:${await clickButtonByText(page, /next step|next|continue/i)}`);
    await page.waitForTimeout(1500);
    stepDiags.push(`s5next:${await clickButtonByText(page, /next step|next|continue/i)}`);
    await page.waitForTimeout(1500);

    // ---- Step 6: Statistics & analytics — skipped, then Finish ----
    const finished = await clickButtonByText(page, /finish|done|complete/i, { timeout: 10000 });
    stepDiags.push(`finish:${finished}`);
    await page.waitForTimeout(5000);
    await page.waitForLoadState("networkidle").catch(() => {});

    if (!siteId) siteId = extractSiteId(page.url());
    const pickDiag = stepDiags.join(" ");
    const matchDiag = "-";
    const typedDiag = await snapshot(page);
    const pickerDiag = "-";

    if (!siteId) {
      const snap = await snapshot(page);
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking wizard ran but no site_id was captured (finish clicked: ${finished}). ${snap} || PICKER: ${pickerDiag} || TYPED: ${typedDiag} || FAILED: ${failedRequests.slice(-6).join(" ; ") || "none"} || PLACES: ${placesRequests.slice(-6).join(" ; ") || "none"} || MATCH: ${matchDiag} || PICK: ${pickDiag}`
      };
    }

    return {
      success: true,
      seRankingProjectId: String(siteId),
      seRankingBacklinksReportId: String(siteId),
      detail: `Created SE Ranking project via wizard (site_id ${siteId}), ${keywords.length} keywords, Google ${country}.`
    };
  } catch (error) {
    return { success: false, needsOperator: true, error: `SE Ranking wizard error: ${error.message}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Best-effort select for the wizard's dropdowns (Country / Language). SE Ranking
// uses custom selects — open the control near the label, then click the option.
async function selectWizardDropdown(page, labelRe, optionText) {
  const trigger = page
    .locator('[role="combobox"], select, [class*="select"]')
    .filter({ hasText: labelRe })
    .first();
  if (await trigger.count().catch(() => 0)) {
    await trigger.click().catch(() => {});
  }
  await page.waitForTimeout(400);
  const opt = page.getByText(optionText, { exact: false }).first();
  if (await opt.count().catch(() => 0)) {
    await opt.click().catch(() => {});
  }
}
