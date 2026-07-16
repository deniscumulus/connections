import { chromium } from "playwright";

const GA4_URL = "https://analytics.google.com/analytics/web/";
const BIGQUERY_PROJECT = process.env.BIGQUERY_CLOUD_PROJECT_ID || "son-gcloud-452110-e8";
const BIGQUERY_LOCATION = process.env.BIGQUERY_DATA_LOCATION || "Frankfurt (europe-west3)";

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

export async function setupGA4(run) {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // 1. Login to Google
    await page.goto("https://accounts.google.com/signin");
    await page.fill('input[type="email"]', run.googleEmail);
    await page.click("button:has-text('Next')");

    if (await checkFor2FAOrCaptcha(page)) {
      throw new Error("2FA or CAPTCHA detected. Operator intervention required.");
    }

    await page.fill('input[type="password"]', run.googlePassword || "");
    await page.click("button:has-text('Next')");
    await page.waitForNavigation();

    if (await checkFor2FAOrCaptcha(page)) {
      throw new Error("2FA or CAPTCHA detected after password. Operator intervention required.");
    }

    // 2. Navigate to GA4 admin
    await page.goto(GA4_URL);
    await waitForSelector(page, "text=Admin", 15000);

    // Click Admin
    await page.click("text=Admin");
    await page.waitForSelector("text=Create property");

    // 3. Create GA4 property
    await page.click("button:has-text('Create property')");
    const propertyNameInput = page.locator('input[placeholder*="Property name"]').first();
    await propertyNameInput.fill(run.projectName);

    await page.click("button:has-text('Create')");
    await page.waitForNavigation({ timeout: 10000 });

    // Capture GA4 Property ID from URL or page
    let ga4PropertyId = "";
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/properties\/(\d+)/);
    if (urlMatch) {
      ga4PropertyId = urlMatch[1];
    }

    if (!ga4PropertyId) {
      throw new Error("Failed to capture GA4 Property ID");
    }

    // 4. Create Web Stream
    await waitForSelector(page, "text=Data streams");
    await page.click("text=Data streams");
    await page.click("button:has-text('Create')");

    const streamTypeInput = page.locator("text=Web").first();
    await streamTypeInput.click();

    const urlInput = page.locator('input[placeholder*="URL"]').first();
    await urlInput.fill(run.siteUrl);

    const streamNameInput = page.locator('input[placeholder*="Stream name"]').first();
    await streamNameInput.fill(`${run.projectName} Web`);

    await page.click("button:has-text('Create stream')");
    await page.waitForNavigation({ timeout: 10000 });

    // Capture Measurement ID and Web Stream ID
    let measurementId = "";
    let webStreamId = "";

    // Get from page content
    const streamText = await page.content();
    const measurementMatch = streamText.match(/G-([A-Z0-9]+)/);
    if (measurementMatch) {
      measurementId = `G-${measurementMatch[1]}`;
    }

    // Get Web Stream ID from URL or by clicking on stream
    const streamUrlMatch = page.url().match(/dataStreams\/(\d+)/);
    if (streamUrlMatch) {
      webStreamId = streamUrlMatch[1];
    }

    if (!measurementId || !webStreamId) {
      throw new Error("Failed to capture Measurement ID or Web Stream ID");
    }

    // 5. Link BigQuery
    await page.goto(`${GA4_URL}#/a${ga4PropertyId}/admin/product-links/big-query`);
    await waitForSelector(page, "text=Link BigQuery project");

    await page.click("button:has-text('Link BigQuery project')");
    await page.waitForSelector('input[placeholder*="Project ID"]', { timeout: 5000 });

    await page.fill('input[placeholder*="Project ID"]', BIGQUERY_PROJECT);

    // Select data location
    await page.click("text=Data location");
    await page.click(`text=${BIGQUERY_LOCATION}`);

    await page.click("button:has-text('Next')");
    await page.waitForNavigation({ timeout: 10000 });

    // 6. Verify BigQuery link was created
    let bigQueryLinked = false;
    try {
      await waitForSelector(page, "text=LINK CREATED", 5000);
      bigQueryLinked = true;
    } catch {
      // Check if already linked
      if (await page.locator("text=Linked").first().isVisible().catch(() => false)) {
        bigQueryLinked = true;
      }
    }

    await browser.close();

    return {
      success: true,
      ga4PropertyId,
      ga4WebStreamId: webStreamId,
      ga4MeasurementId: measurementId,
      ga4BigQueryProjectId: BIGQUERY_PROJECT,
      bigQueryDatasetLocation: BIGQUERY_LOCATION,
      ga4BigQueryLinked: bigQueryLinked
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
