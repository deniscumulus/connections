import { chromium } from "playwright";

// Fill a Yamix text field by its placeholder (taken from the real "new project"
// form: "Enter main project URL", "Enter GSC dataset name", etc.).
async function fillByPlaceholder(page, placeholder, value) {
  if (value == null || value === "") return;
  const field = page.getByPlaceholder(placeholder, { exact: false }).first();
  await field.fill(String(value));
}

// Best-effort select for Yamix's custom dropdowns (Parent project, Market,
// Language): click the control showing `triggerText`, then click the option
// matching `optionText`. NEEDS live verification — the exact DOM of these
// dropdowns and the exact option labels are not confirmed yet.
async function selectDropdown(page, triggerText, optionText) {
  if (!optionText) return;
  await page.getByText(triggerText, { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.getByText(optionText, { exact: true }).first().click().catch(() => {});
}

// Creates a new Yamix project and fills it with the run's derived dataset names,
// the captured SE Ranking IDs, the market and language, and the main project URL.
//
// Grounded on the "Create project / Basic Information" form screenshot:
//   Main Project URL | Parent project (dropdown) | GSC Dataset Name |
//   GA4 Dataset Name | SERanking Project ID | SERanking Backlinks Report ID |
//   Market (dropdown) | Language (dropdown) | Regex Pattern
//
// Still UNCONFIRMED (need screenshots): the login page, how to reach the create
// form, the dropdown DOM/option labels, and the Save button text.
export async function setupYamixUpdate(run, yamixEmail, yamixPassword) {
  let browser;
  try {
    if (!yamixEmail || !yamixPassword) {
      throw new Error("Yamix credentials missing. Configure YAMIX_EMAIL and YAMIX_PASSWORD env vars.");
    }

    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Login. NOTE: login selectors are a best guess (no login screenshot yet).
    await page.goto("https://yamix.com/login");
    await page.fill('input[type="email"]', yamixEmail);
    await page.fill('input[type="password"]', yamixPassword);
    await page.click("button:has-text('Sign in')");
    await page.waitForLoadState("networkidle").catch(() => {});

    // 2. Open the "create project" form. NOTE: exact navigation not confirmed.
    await page.goto("https://yamix.com/settings/projects");
    await page.waitForLoadState();
    const createBtn = page.getByRole("button", { name: /create project|add project|new project/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Fill the Basic Information fields (placeholders from the real form).
    await fillByPlaceholder(page, "Enter main project URL", run.siteUrl);
    await selectDropdown(page, "Select parent project", run.defaults?.yamixParentProject || "SKY Rocket");
    await fillByPlaceholder(page, "Enter GSC dataset name", run.generated?.gscDatasetName);
    await fillByPlaceholder(page, "Enter GA4 dataset name", run.generated?.ga4DatasetName);
    await fillByPlaceholder(page, "Enter SERanking project ID", run.captured?.seRankingProjectId);
    await fillByPlaceholder(page, "Enter backlinks report ID", run.captured?.seRankingBacklinksReportId);
    await selectDropdown(page, "Select Market", run.market);
    await selectDropdown(page, "Select Language", run.language);
    await fillByPlaceholder(page, "Enter regex pattern", run.defaults?.yamixRegexPattern || "");

    // 4. Save. NOTE: exact save/submit button text not confirmed.
    const saveButton = page.getByRole("button", { name: /save|create|submit/i }).first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    const saved = await page
      .getByText(/created|saved|success|updated/i)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    await browser.close();
    return { success: true, yamixUpdated: saved, message: "Yamix project created and filled." };
  } catch (error) {
    if (browser) await browser.close();

    if (/2FA|CAPTCHA|recaptcha/i.test(error.message)) {
      return { success: false, needsOperator: true, error: error.message };
    }
    return { success: false, error: error.message };
  }
}
