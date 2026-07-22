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
import { chromium } from "playwright";

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

async function clickButtonByText(page, re, { timeout = 8000 } = {}) {
  const btn = page.getByRole("button", { name: re }).first();
  if (await btn.count().catch(() => 0)) {
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout }).catch(() => {});
    return true;
  }
  return false;
}

// Snapshot of the current wizard step for diagnostics when something fails.
async function snapshot(page) {
  return page
    .evaluate(() => {
      const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
      const heading = clip(document.querySelector("h1,h2,h3")?.textContent, 40);
      const inputs = [...document.querySelectorAll("input,textarea")]
        .filter((el) => el.type !== "hidden")
        .map((el) => clip(el.placeholder || el.name || el.getAttribute("aria-label") || el.id || "in", 24))
        .slice(0, 12);
      const buttons = [...document.querySelectorAll("button")]
        .map((b) => clip(b.textContent, 20))
        .filter(Boolean)
        .slice(0, 12);
      return JSON.stringify({ url: location.href.slice(0, 80), heading, inputs, buttons });
    })
    .catch(() => "");
}

function extractSiteId(url) {
  const m = String(url || "").match(/site_id=(\d+)/);
  return m ? m[1] : null;
}

// Creates a visible SE Ranking project through the dashboard wizard.
export async function setupSERankingBrowser(run, email, password) {
  let browser;
  try {
    if (!email || !password) {
      return { success: false, needsOperator: true, error: "SE Ranking login not configured (SERANKING_EMAIL / SERANKING_PASSWORD)." };
    }

    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    // 1. Login.
    await page.goto("https://online.seranking.com/login.html");
    await page.waitForLoadState().catch(() => {});
    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    await emailField.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    const pwField = page.locator('input[type="password"]').first();
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

    // 2. Open the create-project wizard.
    await page.goto("https://online.seranking.com/admin.site.wizard.html#/");
    await page.waitForLoadState("networkidle").catch(() => {});
    // Step 1 field.
    const urlField = page
      .locator('input[placeholder*="Website URL" i], input[placeholder*="URL" i], input[type="url"]')
      .first();
    await urlField.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});

    // ---- Step 1: General information ----
    await urlField.click().catch(() => {});
    await urlField.fill(run.siteUrl).catch(() => {});
    // Project name (can be the domain; keep the tool's derived name).
    const nameField = page.locator('input[placeholder*="Project name" i], input[placeholder*="name" i]').nth(1);
    if (await nameField.count().catch(() => 0)) {
      await nameField.fill("").catch(() => {});
      await nameField.fill(run.projectName || run.siteUrl).catch(() => {});
    }
    await page.waitForTimeout(500);
    await clickButtonByText(page, /next step|next|continue/i);
    await page.waitForTimeout(1500);

    // Capture the site_id the wizard assigns after step 1.
    let siteId = extractSiteId(page.url());

    // ---- Step 2: Search engines (Google desktop + mobile for the market) ----
    const country = MARKET_COUNTRY[run.market] || "United Kingdom";
    await selectWizardDropdown(page, /country/i, country).catch(() => {});
    // desktop + mobile device toggles are usually icon buttons near the engine row;
    // best-effort — try to enable both. (Verify in a test run.)
    await clickButtonByText(page, /add search engine/i);
    await page.waitForTimeout(1200);
    await clickButtonByText(page, /next step|next|continue/i);
    await page.waitForTimeout(1200);

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
        await page.waitForTimeout(500);
        await clickButtonByText(page, /add keywords/i);
        await page.waitForTimeout(800);
      }
    }
    await clickButtonByText(page, /next step|next|continue/i);
    await page.waitForTimeout(1000);

    // ---- Step 4: Prompts (skip) ----
    await clickButtonByText(page, /next step|next|continue/i);
    await page.waitForTimeout(800);

    // ---- Step 5: Competitors (skip) ----
    await clickButtonByText(page, /next step|next|continue/i);
    await page.waitForTimeout(800);

    // ---- Step 6: Statistics & Analytics (skip) -> Finish ----
    const finished = await clickButtonByText(page, /finish|done|complete/i);
    await page.waitForTimeout(2500);

    if (!siteId) siteId = extractSiteId(page.url());

    if (!siteId) {
      const snap = await snapshot(page);
      return {
        success: false,
        needsOperator: true,
        error: `SE Ranking wizard ran but no site_id was captured (finish clicked: ${finished}). ${snap}`
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
