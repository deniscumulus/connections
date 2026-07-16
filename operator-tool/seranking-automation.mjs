import { chromium } from "playwright";

const SE_RANKING_LOGIN = "https://online.seranking.com/login.html";

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

export async function setupSERanking(run) {
  let browser;
  try {
    // SE Ranking requires separate credentials (not Google login)
    // For now, we'll skip the actual SE Ranking setup and return a placeholder
    // because SE Ranking credentials aren't yet captured in the run form

    return {
      success: false,
      needsOperator: true,
      error: "SE Ranking credentials not configured. This step requires operator setup via SE Ranking dashboard."
    };

    // TODO: Once SE Ranking credentials are added to run form, implement:
    // 1. Login to SE Ranking with credentials
    // 2. Create new project for the domain
    // 3. Add branded keywords (from run.defaults.seRankingKeywords)
    // 4. Connect GA4 property
    // 5. Connect GSC property
    // 6. Capture Project ID and Backlinks Report ID
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
