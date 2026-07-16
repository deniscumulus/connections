import { chromium } from "playwright";

const YAMIX_URL = "https://yamix.com/settings/projects";

async function waitForSelector(page, selector, timeout = 30000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

export async function setupYamixRead(run) {
  // Yamix requires login and manual navigation to find existing project
  // For initial read phase, return operator-pause since finding the right project
  // requires the operator to know which one is correct

  return {
    success: false,
    needsOperator: true,
    error: "Yamix project discovery requires operator. Please log into Yamix, find the existing project matching this domain, read its Market and Language values, then click Resume automation."
  };

  // TODO: Once Yamix credentials are provided, implement:
  // 1. Login to Yamix with credentials
  // 2. Navigate to Settings > Projects
  // 3. Search for project matching run.hostname
  // 4. Open project details
  // 5. Read Market and Language values
  // 6. Capture them
}

export async function setupYamixUpdate(run, yamixEmail, yamixPassword) {
  let browser;
  try {
    if (!yamixEmail || !yamixPassword) {
      throw new Error("Yamix credentials missing. Configure YAMIX_EMAIL and YAMIX_PASSWORD env vars.");
    }

    browser = await chromium.launch();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // 1. Login to Yamix
    await page.goto("https://yamix.com/login");
    await page.fill('input[type="email"]', yamixEmail);
    await page.fill('input[type="password"]', yamixPassword);
    await page.click("button:has-text('Sign in')");
    await page.waitForNavigation({ timeout: 10000 });

    // 2. Navigate to Settings > Projects
    await page.goto("https://yamix.com/settings/projects");
    await page.waitForLoadState();

    // 3. Search for project matching hostname
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill(run.hostname);
    await page.waitForTimeout(1500);

    // Click the matching project
    const projectLink = page.locator(`text=${run.hostname}`).first();
    await projectLink.click();
    await page.waitForNavigation({ timeout: 10000 });

    // 4. Fill/update fields
    // Main Project URL
    const urlInput = page.locator('input[placeholder*="URL"]').first();
    await urlInput.fill(run.siteUrl);

    // Parent project
    const parentInput = page.locator('input[placeholder*="Parent"]').first();
    await parentInput.fill("SKY Rocket");

    // GSC Dataset Name
    const gscDatasetInput = page.locator('input[placeholder*="GSC"]').first();
    const gscDatasetName = run.generated?.gscDatasetName || `searchconsole_${run.hostname.replace(/^www\./, "").replace(/\..+$/, "")}`;
    await gscDatasetInput.fill(gscDatasetName);

    // GA4 Dataset Name
    const ga4DatasetInput = page.locator('input[placeholder*="GA4"]').first();
    const ga4DatasetName = run.generated?.ga4DatasetName || `analytics_${run.captured?.ga4PropertyId || ""}`;
    await ga4DatasetInput.fill(ga4DatasetName);

    // SE Ranking Project ID
    const seRankingProjectInput = page.locator('input[placeholder*="SE Ranking Project"]').first();
    await seRankingProjectInput.fill(run.captured?.seRankingProjectId || "");

    // SE Ranking Backlinks Report ID
    const seRankingReportInput = page.locator('input[placeholder*="Backlinks"]').first();
    await seRankingReportInput.fill(run.captured?.seRankingBacklinksReportId || "");

    // Regex Pattern (leave empty)
    const regexInput = page.locator('input[placeholder*="Regex"]').first();
    await regexInput.fill("");

    // NOTE: Market and Language are preserved (not updated, read in step 1)

    // 5. Save
    const saveButton = page.locator("button:has-text('Save')").first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Verify saved
    const successMessage = await page.locator("text=Updated").first().isVisible().catch(() => false);

    await browser.close();

    return {
      success: true,
      yamixUpdated: successMessage,
      message: "Yamix project updated with GA4, GSC, and SE Ranking IDs"
    };
  } catch (error) {
    if (browser) await browser.close();

    if (error.message.includes("2FA") || error.message.includes("CAPTCHA")) {
      return {
        success: false,
        needsOperator: true,
        error: error.message
      };
    }

    return {
      success: false,
      error: error.message
    };
  }
}
