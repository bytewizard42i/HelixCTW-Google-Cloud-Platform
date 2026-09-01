// Segmented live capture of the GCP judge console. Each scene records to its
// own WebM so narration can be timed exactly at assembly. Muted; audio is
// mixed in post. Only public production UI is captured.
import puppeteer from "puppeteer";

const DEMO_URL = "https://helixctw-gcp-testwired.vercel.app";
const OUT = "/tmp/helixctw-gcp-video-capture";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  headless: true,
  args: ["--window-size=1920,1080", "--mute-audio", "--hide-scrollbars", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(DEMO_URL, { waitUntil: "networkidle2", timeout: 60_000 });
await sleep(3_500);

async function enabledButton(text, timeout = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const handle = await page.evaluateHandle((label) => {
      return (
        Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.includes(label) && !button.disabled,
        ) ?? null
      );
    }, text);
    const element = handle.asElement();
    if (element) return element;
    await sleep(300);
  }
  throw new Error(`No enabled button: ${text}`);
}

async function scrollCenter(selectorTextOrElement) {
  const element =
    typeof selectorTextOrElement === "string"
      ? await enabledButton(selectorTextOrElement)
      : selectorTextOrElement;
  await element.evaluate((node) =>
    node.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
  await sleep(1_200);
  return element;
}

async function record(name, action) {
  const recorder = await page.screencast({
    path: `${OUT}/${name}.webm`,
    ffmpegPath: "/usr/bin/ffmpeg",
  });
  await action();
  await recorder.stop();
  console.log(`recorded ${name}`);
}

async function checkpointScene(name, label) {
  await record(name, async () => {
    const button = await scrollCenter(label);
    await sleep(600);
    await button.click();
    await enabledButton("Close evidence drawer");
    await sleep(5_200); // hold the drawer: step description + evidence rows
    const close = await enabledButton("Close evidence drawer");
    await close.click();
    await sleep(700);
  });
}

// S1 hero: top of page, slow initial hold then gentle scroll to the case card.
await record("s01-hero", async () => {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(2_800);
  await page.evaluate(() =>
    document.querySelector(".case-card, [data-narration-key='case']")?.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
  await sleep(3_200);
});

// S2 provider matrix: honest evidence labels.
await record("s02-providers", async () => {
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h2, h3")).find((element) =>
      element.textContent?.includes("Every provider shows its work"),
    );
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await sleep(5_500);
});

// S3 readiness gate: connection banner + start guided demo.
await record("s03-gate", async () => {
  await page.evaluate(() => {
    document
      .querySelector(".connection-banner")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(2_600);
  const start = await scrollCenter("Start guided demo");
  await start.click();
  await sleep(3_400);
});

await checkpointScene("s04-cp1", "Load the fictional property case");
await checkpointScene("s05-cp2", "Close this session and forget the chat");
await checkpointScene("s06-cp3", "Ask where we left off");
await checkpointScene("s07-cp4", "Is this property unencumbered?");
await checkpointScene("s08-cp5", "Attempt protected disclosure");
await checkpointScene("s09-cp6", "Run the safe reconstruction drill");
await checkpointScene("s10-cp7", "Ask the permitted question again");

// S11 receipt: fetch and hold the verified receipt evidence.
await record("s11-receipt", async () => {
  const receipt = await scrollCenter("Retrieve receipt from API");
  await receipt.click();
  await sleep(6_000);
});

await browser.close();
console.log("All scenes recorded.");
