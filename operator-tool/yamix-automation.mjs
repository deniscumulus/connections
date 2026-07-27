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

  // Some option lists load asynchronously (the Parent project groups render
  // "Loading..." until they arrive). Wait until the option we want is actually
  // visible (the Parent groups aren't role=option, so don't rely on that), or
  // until loading clears and role=option items exist (Market/Language).
  for (let i = 0; i < 30; i += 1) {
    const targetVisible = await page
      .getByText(optionText, { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (targetVisible) break;
    const stillLoading = await page.getByText(/loading/i).first().isVisible().catch(() => false);
    const optionCount = await page.getByRole("option").count().catch(() => 0);
    if (!stillLoading && optionCount > 0) break;
    await page.waitForTimeout(500);
  }

  // Some dropdowns (e.g. Parent project) have a search box inside — type to
  // filter. Prefer the react-select input (id `react-select-*-input`) which is
  // the real editable control; fall back to a visible search placeholder. Type
  // with pressSequentially so react-select's onChange fires.
  let searched = false;
  let searchBox = page.locator('input[id^="react-select"]').first();
  if (!(await searchBox.count().catch(() => 0)) || !(await searchBox.isVisible().catch(() => false))) {
    searchBox = page.getByPlaceholder(/search/i).first();
  }
  if ((await searchBox.count().catch(() => 0)) && (await searchBox.isVisible().catch(() => false))) {
    await searchBox.click().catch(() => {});
    await searchBox.fill("").catch(() => {});
    await searchBox.pressSequentially(optionText, { delay: 40 }).catch(() => {});
    await page.waitForTimeout(800);
    searched = true;
    // react-select highlights the first filtered match; Enter selects it.
    await searchBox.press("Enter").catch(() => {});
    await page.waitForTimeout(500);
    if (!(await stillPlaceholder())) return null;
  }

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
    if (!(await stillPlaceholder())) return null;
  }

  // Last resort for a searchable dropdown: ArrowDown to highlight, then Enter.
  if (searched) {
    await searchBox.press("ArrowDown").catch(() => {});
    await page.waitForTimeout(200);
    await searchBox.press("Enter").catch(() => {});
    await page.waitForTimeout(500);
    if (!(await stillPlaceholder())) return null;
  }

  // Diagnostic: what options (if any) were actually visible?
  const seen = await page.getByRole("option").allInnerTexts().catch(() => []);
  await page.keyboard.press("Escape").catch(() => {});
  const sample = seen.slice(0, 10).join(", ");
  const diag = seen.length
    ? `options seen: ${sample}${seen.length > 10 ? "…" : ""}`
    : searched
      ? "typed into search but no options rendered"
      : "no search box and no options appeared";
  if (required) {
    throw new Error(`Could not select "${optionText}" in "${triggerText}" (${diag})`);
  }
  // Optional dropdown (e.g. Parent): return the reason instead of failing.
  return `"${optionText}" not selected — ${diag}`;
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

    // Record failed network responses so we can see if a data fetch (e.g. the
    // Parent project groups) is erroring in the automation session.
    const failedRequests = [];
    // Also track the parent-groups XHR (project-groups?page=...&search=) so we
    // can tell whether it fires/succeeds in the headless session — that's why
    // the Parent dropdown sometimes stays "Loading...".
    const groupRequests = [];
    page.on("response", (resp) => {
      try {
        const u = resp.url();
        if (/project-groups/i.test(u)) groupRequests.push(`${resp.status()}`);
        if (resp.status() >= 400) failedRequests.push(`${resp.status()} ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 70)}`);
      } catch {
        /* ignore */
      }
    });
    page._failedRequests = failedRequests;
    page._groupRequests = groupRequests;

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

    // Let the form's async data settle (the Parent project groups load lazily
    // and show "Loading..."; acting before they arrive leaves Parent empty and
    // can block the save). Wait for that indicator to clear.
    await page.waitForLoadState("networkidle").catch(() => {});
    for (let i = 0; i < 24; i += 1) {
      const loading = await page
        .getByText(/loading\.\.\./i)
        .first()
        .isVisible()
        .catch(() => false);
      if (!loading) break;
      await page.waitForTimeout(500);
    }

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
    // Parent: open the dropdown (which triggers the project-groups XHR), wait
    // for that exact response, then pick SKY Rocket from the loaded list. If the
    // groups don't render, close it so the save isn't blocked. The groups:<status>
    // diagnostic tells us whether the XHR fires/succeeds headless.
    let parentDiag = "";
    const parentName = run.defaults?.yamixParentProject || "SKY Rocket";
    try {
      await page.keyboard.press("Escape").catch(() => {});
      const respPromise = page
        .waitForResponse((r) => /project-groups/i.test(r.url()), { timeout: 12000 })
        .catch(() => null);
      // Open the dropdown.
      const combo = page.getByText("Select parent project", { exact: false }).first();
      await combo.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(500);
      // Type into the "Search project groups..." box — that reliably fires the
      // project-groups XHR (opening alone sometimes didn't) and filters the list.
      const search = page.getByPlaceholder(/search project group/i).first();
      let typed = false;
      if (await search.count().catch(() => 0)) {
        await search.click().catch(() => {});
        await search.pressSequentially(parentName, { delay: 60 }).catch(() => {});
        typed = true;
      }
      const resp = await respPromise;
      const groupStatus = resp ? String(resp.status()) : "no-request";
      await page.waitForTimeout(1500);
      // Click the matching option (text nodes only, so we hit the row not input).
      const nameRe = new RegExp(parentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const option = page.locator(`:text("${parentName}"):visible`).first();
      const appeared = await option.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
      if (appeared && (await option.click({ timeout: 5000 }).then(() => true).catch(() => false))) {
        parentDiag = `groups:${groupStatus} typed:${typed} selected`;
      } else {
        await page.keyboard.press("Escape").catch(() => {});
        parentDiag = `groups:${groupStatus} typed:${typed} not-rendered`;
      }
      void nameRe;
    } catch (e) {
      await page.keyboard.press("Escape").catch(() => {});
      parentDiag = `error:${String(e.message || "").slice(0, 40)}`;
    }
    await fillByPlaceholder(page, "Enter GSC dataset name", run.generated?.gscDatasetName);
    await fillByPlaceholder(page, "Enter GA4 dataset name", run.generated?.ga4DatasetName);
    await fillByPlaceholder(page, "Enter SERanking project ID", run.captured?.seRankingProjectId);
    await fillByPlaceholder(page, "Enter backlinks report ID", run.captured?.seRankingBacklinksReportId);
    // Market/Language are required; use the full names the Yamix dropdowns show.
    await selectDropdown(page, "Select Market", MARKET_NAME[run.market] || run.market);
    await selectDropdown(page, "Select Language", run.language);
    await fillByPlaceholder(page, "Enter regex pattern", run.defaults?.yamixRegexPattern || "");

    // Close any open dropdown and let a still-loading Parent settle — a Parent
    // combo stuck on "Loading..." blocks the submit. Wait for it to clear.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    for (let i = 0; i < 40; i += 1) {
      const loading = await page.getByText(/loading\.\.\./i).first().isVisible().catch(() => false);
      if (!loading) break;
      await page.waitForTimeout(500);
    }

    // 4. Save. The submit button may read "Save changes" or "Create project".
    const saveBtn = page
      .getByRole("button", { name: /save changes|create project|^create$|^save$|submit/i })
      .first();
    await saveBtn.scrollIntoViewIfNeeded().catch(() => {});
    await saveBtn.click({ timeout: 8000 });

    // Poll ~10s. The definitive success signal is Yamix navigating from
    // /settings/create-project to the saved project at /settings/edit-project/{id}.
    let saveToast = "";
    let leftForm = false;
    for (let i = 0; i < 20; i += 1) {
      if (/\/settings\/edit-project\//i.test(page.url())) {
        leftForm = true;
        break;
      }
      const toast = await page.locator(".Toastify").first().innerText().catch(() => "");
      if (toast && toast.trim()) {
        saveToast = toast.trim().replace(/\s+/g, " ").slice(0, 200);
        if (/success|created|saved|added|already exists|already taken|duplicate|incorrect|invalid|required|error/i.test(saveToast)) break;
      }
      await page.waitForTimeout(500);
    }

    // If still on the create form, capture WHY. shadcn / react-hook-form render
    // field errors as role=alert or text-destructive paragraphs that don't
    // always contain our keywords, so read those elements directly first, then
    // fall back to keyword-matched lines from the form text.
    const stillOnForm = /\/settings\/create-project/i.test(page.url());
    let inlineErr = "";
    let blockDiag = "";
    if (stillOnForm) {
      const alertText = await page
        .locator('[role="alert"], .text-destructive, [class*="destructive"], [aria-invalid="true"] ~ p, p[id$="-message"]')
        .allInnerTexts()
        .catch(() => []);
      inlineErr = [...new Set(alertText.map((s) => s.trim()).filter(Boolean))].join("; ").slice(0, 240);

      if (!inlineErr) {
        const formText = await page.locator("form").first().innerText().catch(() => "");
        inlineErr = formText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => /required|invalid|must|select|please|least|match|only|maximum|minimum|exist|taken|already|duplicate|incorrect/i.test(s))
          .join("; ")
          .slice(0, 240);
      }

      // Full form snapshot: input values, dropdown (combobox) texts, invalid
      // fields, and submit-button state. One blocked run then shows exactly
      // which field is empty or unselected.
      blockDiag = await page
        .evaluate(() => {
          const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
          const inputs = [...document.querySelectorAll("input, textarea")]
            .filter((el) => el.type !== "hidden")
            .map((el) => `${clip(el.name || el.placeholder || el.getAttribute("aria-label") || el.id || "in", 22)}=${clip(el.value, 28) || "∅"}`);
          const combos = [...document.querySelectorAll('[role="combobox"], [role="button"][aria-haspopup]')]
            .map((el) => clip(el.textContent, 30) || "∅");
          const invalid = [...document.querySelectorAll('[aria-invalid="true"]')]
            .map((el) => clip(el.name || el.placeholder || el.id || "field", 22));
          const buttons = [...document.querySelectorAll("button")]
            .map((b) => `${clip(b.textContent, 18)}${b.disabled ? "(disabled)" : ""}`)
            .filter((t) => /save|create|submit|connect/i.test(t));
          return JSON.stringify({ invalid, buttons, combos, inputs }).slice(0, 700);
        })
        .catch((e) => `diag-error: ${e.message}`);
      const failed = (page._failedRequests || []).slice(-6);
      if (failed.length) blockDiag += ` failedRequests: ${failed.join(" ; ")}`;
      const groups = page._groupRequests || [];
      blockDiag += ` parentGroupsXHR: ${groups.length ? groups.join(",") : "none"} parent:${parentDiag}`;
    }
    const lastUrl = page.url();

    // 5. Ground-truth verification: does the project now appear in the list?
    // The save can succeed without navigating or toasting, so this list check
    // is the real success signal — it must be robust. Give the create API time
    // to commit, use a resilient search-input locator, and read the table text
    // (input values aren't in innerText, so a matched name means a real row).
    const host = (run.hostname || run.siteUrl || "")
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    let created = false;
    try {
      await page.waitForTimeout(2500);
      await page.goto("https://yamix.com/settings/projects");
      await page.waitForLoadState("networkidle").catch(() => {});
      const searchBox = page
        .locator('input[type="search"], input[placeholder*="search" i], [role="searchbox"], input[name*="search" i]')
        .first();
      const hasSearch = (await searchBox.count().catch(() => 0)) > 0;
      const needle = run.projectName.toLowerCase();
      for (const term of [run.projectName, host]) {
        if (created || !term) break;
        if (hasSearch) {
          await searchBox.fill("").catch(() => {});
          await searchBox.fill(term).catch(() => {});
        }
        for (let i = 0; i < 3 && !created; i += 1) {
          await page.waitForTimeout(1200);
          const listText = await page
            .locator("table, main")
            .first()
            .innerText()
            .catch(() => "");
          created = listText.toLowerCase().includes(needle) || listText.toLowerCase().includes(host);
        }
      }
    } catch {
      /* fall through to failure handling */
    }

    await browser.close();

    // Hard rejections from Yamix — the project was NOT created.
    if (/already exists|already taken/i.test(saveToast)) {
      return {
        success: false,
        needsOperator: true,
        error: `Yamix rejected the URL as "already exists" — a project with this URL is already in Yamix (or a stale/orphaned URL from a deleted project). Nothing new was created.`
      };
    }
    if (/duplicate|incorrect|invalid|required/i.test(saveToast) || inlineErr) {
      return {
        success: false,
        needsOperator: true,
        error: `Yamix rejected the save: ${saveToast || inlineErr}`
      };
    }

    // Success: found in the list, OR the create form closed (Yamix moved to the
    // saved project), OR a success toast appeared.
    if (created || leftForm || /success|created|saved|added/i.test(saveToast)) {
      // Surface failed requests even on success, so we can see if the Parent
      // project-groups fetch is erroring in the automation session.
      const failed = (page._failedRequests || []).slice(-5);
      const failedNote = parentDiag && failed.length ? ` [failed: ${failed.join(" ; ")}]` : "";
      return {
        success: true,
        yamixUpdated: created,
        message: `Yamix project "${run.projectName}" created${created ? " and verified in the list" : ""}.${parentDiag ? ` Parent: ${parentDiag}` : " Parent: SKY Rocket selected."}${failedNote}`
      };
    }

    return {
      success: false,
      needsOperator: true,
      error: inlineErr
        ? `Yamix did not save "${run.projectName}" — form validation: ${inlineErr}${blockDiag ? ` [${blockDiag}]` : ""}`
        : `Yamix save outcome unclear for "${run.projectName}" — still on create form, no toast, no field error, not found in the list.${blockDiag ? ` Diagnostic: ${blockDiag}.` : " The Save click may have been silently blocked."}`
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
