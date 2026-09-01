import puppeteer from "puppeteer";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
  headless: true,
  args: ["--window-size=1920,1080", "--mute-audio", "--hide-scrollbars", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto("https://helixctw-gcp-testwired.vercel.app", { waitUntil: "networkidle2", timeout: 60_000 });
await sleep(4_000);
const recorder = await page.screencast({
  path: "/tmp/helixctw-gcp-video-capture/s01-hero.webm",
  ffmpegPath: "/usr/bin/ffmpeg",
});
// The screencast emits frames only on repaint: keep gentle motion throughout.
await page.mouse.move(960, 540);
for (let i = 0; i < 12; i += 1) {
  await page.mouse.wheel({ deltaY: 6 });
  await sleep(220);
}
await sleep(600);
for (let i = 0; i < 30; i += 1) {
  await page.mouse.wheel({ deltaY: 28 });
  await sleep(110);
}
await sleep(900);
await recorder.stop();
await browser.close();
console.log("re-recorded s01-hero");
