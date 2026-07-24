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
    // ---- The wizard is a SINGLE-PAGE form (confirmed from a live snapshot) ----
    // Placeholders: "Enter domain or URL", "Enter project name", "Enter keywords".
    // Engine buttons: Google / AI Overviews / AI Mode / ChatGPT (Google is the
    // default). Location control: "Enter country, city". Submit: "Start tracking".
    const urlField = page.getByPlaceholder(/enter domain or url/i).first();
    await urlField.waitFor({ state: "visible", timeout: 25000 });
    await urlField.click().catch(() => {});
    await urlField.fill(run.siteUrl).catch(() => {});
    await page.waitForTimeout(400);

    const nameField = page.getByPlaceholder(/enter project name/i).first();
    if (await nameField.count().catch(() => 0)) {
      await nameField.click().catch(() => {});
      await nameField.fill(run.projectName || run.siteUrl).catch(() => {});
    }

    // Make sure the classic Google engine is the selected one.
    await clickButtonByText(page, /^google$/i).catch(() => {});

    // Location is a BUTTON ("Enter country, city"), not an input — clicking it
    // opens a picker with a search box. Leaving it empty fails validation with
    // "Enter country, city or postal code".
    const country = MARKET_COUNTRY[run.market] || "United Kingdom";
    // The location field only exists once the picker is open (the closed state
    // is just a button), and the page has its own "Search" box, so selectors are
    // unreliable here. Open the picker and type into whatever it focuses.
    // The "Keyword suggestions" panel is open by default and can cover the
    // location control — dismiss it first, otherwise the click is intercepted and
    // silently does nothing. (Its "Search" box belongs to keyword suggestions,
    // NOT the country: typing the country there just yields "Nothing found".)
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
    let countryClicked = await clickButtonByText(page, /enter country|country, ?city/i);
    if (!countryClicked) {
      countryClicked = await clickButtonByText(page, /enter country|country, ?city/i, { force: true });
    }
    await page.waitForTimeout(1500);
    // Capture what the picker looks like right after opening — this is the only
    // way to see it, since it's gone by the time the failure snapshot is taken.
    const pickerDiag = `countryBtnClicked:${countryClicked} ` + (await snapshot(page));
    // The opened picker renders its own input with placeholder
    // "Enter country, city or postal code" — "postal" uniquely identifies it
    // (the page's other boxes are "Search" / "Enter domain or URL").
    const locInput = page.locator('input[placeholder*="postal" i]').first();
    await locInput.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    // The picker opens with its search field already focused, so type straight
    // into it with real key events. Clicking + fill("") on the input first was
    // disturbing the component so its search never fired — typed manually, the
    // full country name does return suggestions.
    await page.keyboard.type(country, { delay: 120 });
    await page.waitForTimeout(2500);
    // State right after typing: is the location field filled, and did the
    // suggestion list appear? (The picker requires PICKING a suggestion —
    // "Type in a new location name to view the schedules.")
    const typedDiag = await snapshot(page);
    // The text alone isn't enough — the location is only committed when a
    // SUGGESTION is picked ("Type in a new location name to view the
    // schedules."). Wait for the suggestion to render, then click it.
    // getByText matches text nodes only, so it hits the dropdown entry and not
    // the input (whose *value* is the country).
    // Require :visible — plain getByText was resolving to an off-screen node, so
    // the click timed out and nothing got selected. Note the UK is listed as
    // "United Kingdom of Great Britain and Northern Ireland", so the configured
    // name matches as a prefix.
    let picked = false;
    const visibleSuggestion = page.locator(`:text("${country}"):visible`).first();
    await visibleSuggestion.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    if (await visibleSuggestion.count().catch(() => 0)) {
      try {
        await visibleSuggestion.click({ timeout: 6000 });
        picked = true;
      } catch {
        /* fall through to keyboard */
      }
    }
    if (!picked) {
      await page.keyboard.press("ArrowDown").catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
    }
    await page.waitForTimeout(2000);

    // Keywords (one per line).
    const keywords = (run.defaults?.seRankingKeywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 10);
    if (keywords.length) {
      const kwField = page.getByPlaceholder(/enter keywords/i).first();
      if (await kwField.count().catch(() => 0)) {
        await kwField.click().catch(() => {});
        await kwField.fill(keywords.join("\n")).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // Submit — "Start tracking" creates the project.
    const finished = await clickButtonByText(page, /start tracking/i, { timeout: 10000 });
    await page.waitForTimeout(6000);
    await page.waitForLoadState("networkidle").catch(() => {});

    let siteId = extractSiteId(page.url());

    if (!siteId) siteId = extractSiteId(page.url());

    if (!siteId) {
      const snap = await snapshot(page);
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking wizard ran but no site_id was captured (finish clicked: ${finished}). ${snap} || PICKER: ${pickerDiag} || TYPED: ${typedDiag}`
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
