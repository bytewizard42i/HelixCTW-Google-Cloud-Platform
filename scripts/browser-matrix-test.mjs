// browser-matrix-test.mjs — run the LIVE judge journey across five
// desktop/mobile browser profiles and report a pass/fail matrix.
//
// WHAT THIS TESTS (plain English):
//   For each profile it loads https://helixctw-gcp-testwired.vercel.app,
//   clicks "Start guided demo", walks all seven checkpoints, retrieves the
//   final receipt, and records every console error, page error, and failed
//   network request. A profile passes only if every step shows real evidence
//   and nothing errored.
//
// ONE-TIME SETUP (from the repo root):
//   npm --prefix scripts install          # installs pinned playwright
//   npx --prefix scripts playwright install chromium webkit
//   sudo npx --prefix scripts playwright install-deps webkit   # system libs (once per machine)
//
// RUN (from the repo root):
//   node scripts/browser-matrix-test.mjs                 # all five profiles
//   ONLY_PROFILE=desktop-chromium node scripts/browser-matrix-test.mjs
//
// NOTE: each profile performs a real journey against the production API
// (about 60-90 seconds each), writing genuine synthetic-scenario runs.

import { chromium, webkit, devices } from "playwright";

const SITE = "https://helixctw-gcp-testwired.vercel.app";
const STEPS = [
  "Load the fictional property case",
  "Close this session and forget the chat",
  "Ask where we left off",
  "Is this property unencumbered?",
  "Attempt protected disclosure",
  "Run the safe reconstruction drill",
  "Ask the permitted question again",
];

// WebKit is the engine inside every iPhone browser; Chromium covers
// Chrome/Edge/Android. Together these five profiles span the real market.
const PROFILES = [
  { name: "desktop-chromium", engine: chromium, options: { viewport: { width: 1920, height: 1080 } } },
  { name: "android-pixel7", engine: chromium, options: { ...devices["Pixel 7"] } },
  { name: "iphone-14-emulated", engine: chromium, options: { ...devices["iPhone 14"] } },
  { name: "desktop-webkit", engine: webkit, options: { viewport: { width: 1440, height: 900 } } },
  { name: "iphone-14-webkit", engine: webkit, options: { ...devices["iPhone 14"] } },
];

async function runProfile({ name, engine, options }) {
  const report = { name, consoleErrors: [], pageErrors: [], failedRequests: [], steps: {}, receipt: null };
  let browser;
  try {
    browser = await engine.launch({ headless: true });
  } catch (error) {
    report.launchError = String(error.message).split("\n")[0];
    return report;
  }
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error).slice(0, 200)));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (!failure.includes("ERR_ABORTED")) {
      report.failedRequests.push(`${request.method()} ${request.url().slice(0, 120)} ${failure}`);
    }
  });

  // Checkpoint buttons stay disabled until the readiness gate passes, so
  // "wait until enabled, then click" is itself part of the test.
  const clickWhenEnabled = async (label, timeout = 40_000) => {
    const button = page.locator("button", { hasText: label }).first();
    await button.waitFor({ state: "visible", timeout });
    const startedAt = Date.now();
    while (await button.isDisabled()) {
      if (Date.now() - startedAt > timeout) throw new Error(`button stayed disabled: ${label}`);
      await page.waitForTimeout(300);
    }
    await button.click();
  };

  try {
    await page.goto(SITE, { waitUntil: "networkidle", timeout: 60_000 });
    await clickWhenEnabled("Start guided demo");
    for (const label of STEPS) {
      await clickWhenEnabled(label);
      // Success opens the evidence drawer; failure shows a fail-closed banner.
      await page.locator("button", { hasText: "Close evidence drawer" }).first().waitFor({ state: "visible", timeout: 40_000 });
      const failed = await page.getByText("Failed closed").count();
      report.steps[label] = failed > 0 ? "FAILED-CLOSED" : "passed";
      if (failed > 0) break;
      await page.locator("button", { hasText: "Close evidence drawer" }).first().click();
      await page.waitForTimeout(400);
    }
    const reopen = page.locator("button", { hasText: "Open evidence drawer" }).first();
    if (await reopen.count()) await reopen.click();
    await clickWhenEnabled("Retrieve receipt from API");
    await page.waitForTimeout(4_000);
    report.receipt = (await page.getByText("Failed closed").count()) > 0 ? "FAILED-CLOSED" : "passed";
  } catch (error) {
    report.journeyError = String(error.message).split("\n")[0].slice(0, 200);
  }
  await browser.close();
  return report;
}

const selected = PROFILES.filter(
  (profile) => !process.env.ONLY_PROFILE || profile.name === process.env.ONLY_PROFILE,
);
let allPassed = true;
for (const profile of selected) {
  const report = await runProfile(profile);
  const passed =
    !report.launchError &&
    !report.journeyError &&
    report.receipt === "passed" &&
    Object.values(report.steps).every((state) => state === "passed") &&
    Object.keys(report.steps).length === STEPS.length &&
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.failedRequests.length === 0;
  allPassed &&= passed;
  console.log(JSON.stringify({ verdict: passed ? "PASS" : "FAIL", ...report }, null, 1));
}
process.exit(allPassed ? 0 : 1);
