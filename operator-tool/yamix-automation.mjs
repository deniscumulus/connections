import { chromium } from "playwright";

// The Yamix Market dropdown uses full country names, not our 2-letter codes.
const MARKET_NAME = {
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

// Fill a Yamix text field by its placeholder (taken from the real "new project"
// form: "Enter main project URL", "Enter GSC dataset name", etc.).
async function fillByPlaceholder(page, placeholder, value) {
  if (value == null || value === "") return;
  const field = page.getByPlaceholder(placeholder, { exact: false }).first();
  await field.fill(String(value));
}

// Fill the first locator that actually exists (avoids a 30s hang on a guessed
// selector). Returns true if something was filled.
async function fillFirstAvailable(page, locators, value) {
  if (value == null || value === "") return false;
  for (const loc of locators) {
    const el = loc.first();
    if (await el.count().catch(() => 0)) {
      try {
        await el.fill(String(value));
        return true;
      } catch {
        /* try the next locator */
      }
    }
  }
  return false;
}

// Select an option in Yamix's custom dropdowns (Parent, Market, Language): click
// the control showing `triggerText` to open it, then click the option whose exact
// label is `optionText` (Market/Language options are full names like "United
// Kingdom" / "English"). Throws if a required option can't be selected.
async function selectDropdown(page, triggerText, optionText, { required = true } = {}) {
  if (!optionText) return;

  // The trigger shows the placeholder (e.g. "Select Market") until a value is
  // chosen; once selected it shows the value instead. Use that to VERIFY the pick.
  const stillPlaceholder = async () =>
    (await page.getByText(triggerText, { exact: false }).count().catch(() => 0)) > 0;

  await page.keyboard.press("Escape").catch(() => {});

  // Open the select. shadcn/Radix triggers have role=combobox showing the
  // placeholder; fall back to clicking the placeholder text.
  const combo = page.getByRole("combobox").filter({ hasText: triggerText }).first();
  if (await combo.count().catch(() => 0)) {
    await combo.click({ timeout: 8000 }).catch(() => {});
  } else {
    await page.getByText(triggerText, { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(700);

  const candidates = [
    page.getByRole("option", { name: optionText, exact: true }).first(),
    page.getByRole("option", { name: optionText }).first(),
    page.locator(`[role="option"]:has-text("${optionText}")`).first(),
    page.getByText(optionText, { exact: true }).first()
  ];
  for (const el of candidates) {
    if (!(await el.count().catch(() => 0))) continue;
    try {
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(400);
    } catch {
      continue;
    }
    // Only treat it as done if the trigger no longer shows the placeholder.
    if (!(await stillPlaceholder())) return;
  }

  // Diagnostic: what options (if any) were actually visible?
  const seen = await page.getByRole("option").allInnerTexts().catch(() => []);
  await page.keyboard.press("Escape").catch(() => {});
  if (required) {
    const sample = seen.slice(0, 10).join(", ");
    throw new Error(
      `Could not select "${optionText}" in "${triggerText}"` +
        (seen.length ? ` (options seen: ${sample}${seen.length > 10 ? "…" : ""})` : " (dropdown did not open — no options appeared)")
    );
  }
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
    // Project name (required). Not in the Basic Information block — try its label
    // and a few likely placeholders. Value is the derived "<Casino> <MARKET>".
    await fillFirstAvailable(
      page,
      [
        page.getByLabel("Project name", { exact: false }),
        page.getByPlaceholder("Enter project name", { exact: false }),
        page.getByPlaceholder("project name", { exact: false })
      ],
      run.projectName
    );
    // Parent project is optional (no red *), so don't fail the run if it's missing.
    await selectDropdown(page, "Select parent project", run.defaults?.yamixParentProject || "SKY Rocket", {
      required: false
    });
    await fillByPlaceholder(page, "Enter GSC dataset name", run.generated?.gscDatasetName);
    await fillByPlaceholder(page, "Enter GA4 dataset name", run.generated?.ga4DatasetName);
    await fillByPlaceholder(page, "Enter SERanking project ID", run.captured?.seRankingProjectId);
    await fillByPlaceholder(page, "Enter backlinks report ID", run.captured?.seRankingBacklinksReportId);
    // Market/Language are required; use the full names the Yamix dropdowns show.
    await selectDropdown(page, "Select Market", MARKET_NAME[run.market] || run.market);
    await selectDropdown(page, "Select Language", run.language);
    await fillByPlaceholder(page, "Enter regex pattern", run.defaults?.yamixRegexPattern || "");

    // 4. Save. The submit button may read "Save changes" or "Create project".
    const saveBtn = page
      .getByRole("button", { name: /save changes|create project|^create$|^save$|submit/i })
      .first();
    await saveBtn.scrollIntoViewIfNeeded().catch(() => {});
    await saveBtn.click({ timeout: 8000 });

    // Capture any toast that appears (success, or "already exists", etc.).
    let saveToast = "";
    for (let i = 0; i < 8; i += 1) {
      const toast = await page.locator(".Toastify").first().innerText().catch(() => "");
      if (toast && toast.trim()) {
        saveToast = toast.trim().replace(/\s+/g, " ").slice(0, 180);
        break;
      }
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1500);

    // 5. Ground-truth verification: does the project now appear in the list?
    let created = false;
    try {
      await page.goto("https://yamix.com/settings/projects");
      await page.waitForLoadState().catch(() => {});
      const search = page.getByPlaceholder("Search", { exact: false }).first();
      if (await search.count().catch(() => 0)) {
        await search.fill(run.projectName).catch(() => {});
        await page.waitForTimeout(1500);
      }
      created = await page
        .getByText(run.projectName, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
    } catch {
      /* fall through to failure handling */
    }

    await browser.close();

    if (created) {
      return { success: true, yamixUpdated: true, message: `Yamix project "${run.projectName}" created and verified in the list.` };
    }
    if (/already exists|already taken/i.test(saveToast)) {
      // NOT a success: Yamix rejected the URL but no project is in the list — a
      // stale/orphaned URL (from a previously deleted project). Nothing was created.
      return {
        success: false,
        needsOperator: true,
        error: `Yamix rejected the URL as "already exists", but "${run.projectName}" is NOT in the projects list — a Yamix orphaned URL (leftover from a deleted project). The project was NOT created. Use a fresh URL, or have Yamix clear the stale URL.`
      };
    }
    return {
      success: false,
      error: `Yamix project "${run.projectName}" not found in the list after Save${saveToast ? ` (toast: ${saveToast})` : " (no toast seen)"}`
    };
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
