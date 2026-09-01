// Resume: fast-run the journey (unrecorded), then record only the receipt
// scene with the evidence drawer open.
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
await sleep(3_000);

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

async function step(label) {
  const button = await enabledButton(label);
  await button.evaluate((node) => node.click());
  const close = await enabledButton("Close evidence drawer");
  await sleep(600);
  await close.evaluate((node) => node.click());
  await sleep(500);
}

for (const label of [
  "Load the fictional property case",
  "Close this session and forget the chat",
  "Ask where we left off",
  "Is this property unencumbered?",
  "Attempt protected disclosure",
  "Run the safe reconstruction drill",
  "Ask the permitted question again",
]) {
  await step(label);
  console.log(`done: ${label}`);
}

// Reopen the drawer, then record fetching the receipt inside it.
const open = await enabledButton("Open evidence drawer");
await open.evaluate((node) => node.click());
await sleep(1_200);

const recorder = await page.screencast({
  path: `${OUT}/s11-receipt.webm`,
  ffmpegPath: "/usr/bin/ffmpeg",
});
await sleep(1_500);
const retrieve = await enabledButton("Retrieve receipt from API");
await retrieve.evaluate((node) => node.click());
await sleep(6_500);
await recorder.stop();
await browser.close();
console.log("recorded s11-receipt");
