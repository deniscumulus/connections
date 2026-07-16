import { chromium } from "playwright";

const GSC_URL = "https://search.google.com/search-console/welcome";
const BIGQUERY_PROJECT = process.env.BIGQUERY_CLOUD_PROJECT_ID || "son-gcloud-452110-e8";
const BIGQUERY_LOCATION = process.env.BIGQUERY_DATA_LOCATION || "Frankfurt (europe-west3)";

function deriveGscDatasetName(hostname) {
  if (!hostname) return "";
  return `searchconsole_${hostname.replace(/^www\./, "").replace(/\..+$/, "").replace(/\./g, "_")}`;
}

async function waitForSelector(page, selector, timeout = 30000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function checkFor2FAOrCaptcha(page) {
  const indicators = [
    "text=verify",
    "text=2-Step",
    "text=2FA",
    "text=Captcha",
    "text=unusual activity",
    'iframe[src*="recaptcha"]',
    'iframe[src*="challenge"]'
  ];

  for (const indicator of indicators) {
    if (await page.locator(indicator).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

export async function setupGSC(run, googlePassword) {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    if (!run.googleEmail || !googlePassword) {
      throw new Error("Google credentials missing. Configure GOOGLE_EMAIL and GOOGLE_PASSWORD env vars.");
    }

    // 1. Login to Google
    await page.goto("https://accounts.google.com/signin");
    await page.fill('input[type="email"]', run.googleEmail);
    await page.click("button:has-text('Next')");

    if (await checkFor2FAOrCaptcha(page)) {
      throw new Error("2FA or CAPTCHA detected. Operator intervention required.");
    }

    await page.fill('input[type="password"]', googlePassword);
    await page.click("button:has-text('Next')");
    await page.waitForNavigation();

    if (await checkFor2FAOrCaptcha(page)) {
      throw new Error("2FA or CAPTCHA detected after password. Operator intervention required.");
    }

    // 2. Navigate to GSC
    await page.goto(GSC_URL);
    await waitForSelector(page, "text=URL prefix property");

    // 3. Create URL-prefix property
    const addPropertyButton = page.locator("button:has-text('Add property')").first();
    await addPropertyButton.click();

    // Wait for dialog and enter URL
    await waitForSelector(page, 'input[placeholder*="https"]');
    const urlInput = page.locator('input[placeholder*="https"]').first();
    await urlInput.fill(run.siteUrl);

    // Click Continue
    const continueBtn = page.locator("button:has-text('Continue')").first();
    await continueBtn.click();
    await page.waitForNavigation({ timeout: 10000 });

    // 4. Verify property ownership - get verification meta tag
    let verificationMetaTag = "";
    let verificationContent = "";

    // Look for HTML tag verification option
    const htmlTabButton = page.locator("text=HTML tag").first();
    if (await htmlTabButton.isVisible().catch(() => false)) {
      await htmlTabButton.click();
    }

    // Extract the meta tag from page content or visible text
    const pageContent = await page.content();
    const metaMatch = pageContent.match(/<meta\s+name="google-site-verification"\s+content="([^"]+)"/);
    if (metaMatch) {
      verificationContent = metaMatch[1];
      verificationMetaTag = `<meta name="google-site-verification" content="${verificationContent}" />`;
    }

    if (!verificationContent) {
      throw new Error("Failed to extract GSC verification meta tag");
    }

    // 5. Configure Bulk Data Export to BigQuery
    // Click Settings
    await page.click("text=Settings");
    await waitForSelector(page, "text=Bulk data export");

    const bulkExportLink = page.locator("text=Bulk data export").first();
    await bulkExportLink.click();

    // Click "Set up export" or similar button
    const setupButton = page.locator("button:has-text('Set up')").first();
    if (await setupButton.isVisible().catch(() => false)) {
      await setupButton.click();
    } else {
      const addButton = page.locator("button:has-text('Add destination')").first();
      await addButton.click();
    }

    // Select BigQuery
    await waitForSelector(page, "text=BigQuery");
    await page.click("text=BigQuery");

    // Enter Cloud project ID
    await waitForSelector(page, 'input[placeholder*="Project"]');
    const projectInput = page.locator('input[placeholder*="Project"]').first();
    await projectInput.fill(BIGQUERY_PROJECT);

    // Enter dataset name
    const datasetName = deriveGscDatasetName(run.hostname);
    const datasetInput = page.locator('input[placeholder*="Dataset"]').first();
    await datasetInput.fill(datasetName);

    // Select data location
    const locationDropdown = page.locator("text=Data location").first();
    await locationDropdown.click();
    await page.click(`text=${BIGQUERY_LOCATION}`);

    // Confirm/Save
    const saveButton = page.locator("button:has-text('Save')").first();
    await saveButton.click();
    await page.waitForTimeout(3000);

    // 6. Verify setup was saved
    let bulkExportConfigured = false;
    if (await page.locator("text=BigQuery").first().isVisible().catch(() => false)) {
      bulkExportConfigured = true;
    }

    await browser.close();

    return {
      success: true,
      gscVerificationMetaTag: verificationMetaTag,
      gscVerificationContent: verificationContent,
      gscBulkDataExportDestination: `${BIGQUERY_PROJECT}:${datasetName}`,
      gscBulkDataExportDatasetLocation: BIGQUERY_LOCATION,
      gscBulkExportConfigured: bulkExportConfigured,
      gscDatasetName: datasetName
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
