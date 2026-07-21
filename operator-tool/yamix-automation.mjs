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
// Confirmed from screenshots: login ("Log in", no CAPTCHA), navigation
// (Settings > Projects > "Create Project"), field placeholders, and Save
// ("Save changes"). Still UNCONFIRMED: the Parent/Market/Language dropdown DOM
// and their exact option labels — selectDropdown is best-effort until verified.
export async function setupYamixUpdate(run, yamixEmail, yamixPassword) {
  let browser;
  let page;
  try {
    if (!yamixEmail || !yamixPassword) {
      throw new Error("Yamix credentials missing. Configure YAMIX_EMAIL and YAMIX_PASSWORD env vars.");
    }

    browser = await chromium.launch();
    const context = await browser.newContext();
    page = await context.newPage();

    // 1. Login at the canonical sign-in page. Wait for the form to render before
    // filling (going to the root races a redirect to /auth/sign-in). Confirmed DOM:
    // input[type=email] (placeholder "example@gmail.com"), input[type=password],
    // button "Log in" (type=submit). No CAPTCHA.
    await page.goto("https://yamix.com/auth/sign-in");
    await page.waitForLoadState().catch(() => {});
    await page.getByPlaceholder("example@gmail.com").first().waitFor({ state: "visible", timeout: 20000 });
    // Type into the fields (not instant fill) so React's controlled inputs update
    // and the submit button enables. Submit via both click and Enter.
    const emailField = page.locator('input[type="email"]').first();
    const pwField = page.locator('input[type="password"]').first();
    await emailField.click();
    await emailField.pressSequentially(yamixEmail, { delay: 25 });
    await pwField.click();
    await pwField.pressSequentially(yamixPassword, { delay: 25 });
    await page.click("button:has-text('Log in')").catch(() => {});
    await pwField.press("Enter").catch(() => {});

    // Confirm login succeeded (sign-in form goes away). Yamix shows errors as
    // react-toastify toasts that vanish quickly, so poll for the toast text while
    // waiting, instead of only reading the page once after a timeout.
    let loggedIn = false;
    let toastMsg = "";
    for (let i = 0; i < 24; i += 1) {
      const emailGone = await page
        .locator('input[type="email"]')
        .first()
        .isVisible()
        .then((v) => !v)
        .catch(() => true);
      if (emailGone) {
        loggedIn = true;
        break;
      }
      const toast = await page
        .locator(".Toastify__toast, .Toastify")
        .first()
        .innerText()
        .catch(() => "");
      if (toast && toast.trim()) toastMsg = toast.trim().replace(/\s+/g, " ").slice(0, 160);
      await page.waitForTimeout(500);
    }
    if (!loggedIn) {
      // Also read the persistent inline validation errors under the fields
      // (e.g. "Password must contain at least one uppercase letter"), which reveal
      // whether the password/email reaching the worker is invalid or mangled.
      const formText = await page.locator("form").first().innerText().catch(() => "");
      const inlineErr = formText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => /invalid|must|required|least|uppercase|lowercase|match|format|character|credential|incorrect|wrong/i.test(s))
        .join("; ")
        .slice(0, 200);
      const detail = [toastMsg, inlineErr].filter(Boolean).join(" | ");
      // Safe diagnostic: show the email used and the password LENGTH (not the
      // password), so we can tell if the wrong/empty/truncated value reached the
      // worker vs. genuinely wrong credentials.
      const creds = `[email: ${yamixEmail || "(empty)"}, pwLen: ${(yamixPassword || "").length}]`;
      throw new Error(
        `Yamix login did not complete${detail ? `: ${detail}` : " (still on the sign-in form)"} ${creds}`
      );
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000);

    // 2. Open the create-project form and wait for it to actually render.
    await page.goto("https://yamix.com/settings/create-project");
    await page.waitForLoadState().catch(() => {});
    await page
      .getByPlaceholder("Enter main project URL")
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

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

    // 4. Save (confirmed: "Save changes").
    await page.getByRole("button", { name: /save changes/i }).first().click();
    await page.waitForTimeout(2000);

    const saved = await page
      .getByText(/created|saved|success|updated/i)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    await browser.close();
    return { success: true, yamixUpdated: saved, message: "Yamix project created and filled." };
  } catch (error) {
    // Include where the page ended up, so failures are diagnosable (e.g. still
    // on the login root vs. the create-project form).
    const where = page ? ` [at ${page.url()}]` : "";
    if (browser) await browser.close();

    if (/2FA|CAPTCHA|recaptcha/i.test(error.message)) {
      return { success: false, needsOperator: true, error: error.message + where };
    }
    return { success: false, error: error.message + where };
  }
}
