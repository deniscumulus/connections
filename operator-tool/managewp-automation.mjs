import { chromium } from "playwright";

const MANAGEWP_LOGIN = "https://orion.managewp.com/login";

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
    'iframe[src*="recaptcha"]'
  ];

  for (const indicator of indicators) {
    if (await page.locator(indicator).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

export async function setupManageWPHFCM(run, managewpEmail, managewpPassword) {
  let browser;
  try {
    if (!managewpEmail || !managewpPassword) {
      throw new Error("ManageWP credentials missing. Configure MANAGEWP_EMAIL and MANAGEWP_PASSWORD env vars.");
    }

    browser = await chromium.launch();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // 1. Login to ManageWP
    await page.goto(MANAGEWP_LOGIN);
    await page.fill('input[type="email"]', managewpEmail);
    await page.click("button:has-text('Sign in')");

    if (await checkFor2FAOrCaptcha(page)) {
      throw new Error("2FA or CAPTCHA detected. Operator intervention required.");
    }

    await page.fill('input[type="password"]', managewpPassword);
    await page.click("button:has-text('Sign in')");
    await page.waitForNavigation({ timeout: 10000 });

    // 2. Find site by hostname
    await waitForSelector(page, "text=Sites");
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill(run.hostname);
    await page.waitForTimeout(2000);

    // Find and click the matching site
    const siteLink = page.locator(`text=${run.hostname}`).first();
    await siteLink.click();
    await page.waitForNavigation({ timeout: 10000 });

    // 3. Open WP Admin
    await waitForSelector(page, "text=WP Admin");
    const wpAdminButton = page.locator("button:has-text('WP Admin')").first();
    if (await wpAdminButton.isVisible().catch(() => false)) {
      await wpAdminButton.click();
    } else {
      const wpAdminLink = page.locator("a:has-text('WP Admin')").first();
      await wpAdminLink.click();
    }

    // Switch to WP admin tab
    const pages = await context.pages();
    let wpAdminPage = pages[pages.length - 1];
    if (wpAdminPage === page) wpAdminPage = pages[pages.length - 2];
    await wpAdminPage.waitForLoadState();

    // 4. Navigate to HFCM plugin
    await waitForSelector(wpAdminPage, "text=Header Footer Code Manager");
    const hfcmLink = wpAdminPage.locator("a:has-text('Header Footer Code Manager')").first();
    if (await hfcmLink.isVisible().catch(() => false)) {
      await hfcmLink.click();
      await wpAdminPage.waitForLoadState();
    }

    // 5. Create GSC snippet
    const addSnippetButton = wpAdminPage.locator("button:has-text('Add Snippet')").first();
    await addSnippetButton.click();
    await waitForSelector(wpAdminPage, 'input[placeholder*="Title"]');

    // Fill GSC snippet form
    const titleInput = wpAdminPage.locator('input[placeholder*="Title"]').first();
    await titleInput.fill(`Google Search Console - ${run.projectName}`);

    const codeInput = wpAdminPage.locator('textarea[placeholder*="Code"]').first();
    const gscMetaTag = run.captured?.gscVerificationMetaTag || "";
    await codeInput.fill(gscMetaTag);

    // Set location to Header
    const locationSelect = wpAdminPage.locator("select").first();
    await locationSelect.selectOption({ label: "Header" });

    // Save snippet
    const saveButton = wpAdminPage.locator("button:has-text('Save')").first();
    await saveButton.click();
    await wpAdminPage.waitForTimeout(2000);

    // 6. Create GA4 snippet
    await addSnippetButton.click();
    await waitForSelector(wpAdminPage, 'input[placeholder*="Title"]');

    const titleInput2 = wpAdminPage.locator('input[placeholder*="Title"]').nth(1);
    await titleInput2.fill(`Google Analytics GA4 - ${run.projectName}`);

    const codeInput2 = wpAdminPage.locator('textarea[placeholder*="Code"]').nth(1);
    const ga4Code = `(function() {
  var measurementId = "${run.captured?.ga4MeasurementId || ""}";
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function() {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
})();`;
    await codeInput2.fill(ga4Code);

    // Set type to JavaScript and location to Header
    const typeSelect = wpAdminPage.locator("select").nth(1);
    await typeSelect.selectOption({ label: "JavaScript" });

    const locationSelect2 = wpAdminPage.locator("select").nth(2);
    await locationSelect2.selectOption({ label: "Header" });

    // Save GA4 snippet
    await saveButton.click();
    await wpAdminPage.waitForTimeout(2000);

    // 7. Verify snippets in page source
    await wpAdminPage.goto(run.siteUrl);
    const pageSource = await wpAdminPage.content();

    const gscVerified = pageSource.includes(run.captured?.gscVerificationContent || "");
    const ga4Verified = pageSource.includes(run.captured?.ga4MeasurementId || "");

    await browser.close();

    return {
      success: true,
      hfcmGscSnippetCreated: gscVerified,
      hfcmGa4SnippetCreated: ga4Verified,
      snippetsVerified: gscVerified && ga4Verified
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
