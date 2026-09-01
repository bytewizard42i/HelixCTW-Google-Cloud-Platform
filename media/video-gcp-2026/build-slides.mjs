// Build exact-typography 1920×1080 slides for the GCP TestWired video.
// Generated backgrounds remain text-free; SVG overlays guarantee correct
// spelling, line breaks, colors, and safe margins for YouTube playback.

import { execFile } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const slideDirectory = join(dirname(fileURLToPath(import.meta.url)), "slides");
const run = promisify(execFile);
const escapeXml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function svgDocument(content) {
  return Buffer.from(`
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      <style>
        .sans { font-family: Inter, Arial, sans-serif; }
        .mono { font-family: 'DejaVu Sans Mono', monospace; }
      </style>
      ${content}
    </svg>
  `);
}

async function compositeSlide(backgroundName, overlay, outputName) {
  const temporaryOverlay = join("/tmp", `${outputName}.svg`);
  await writeFile(temporaryOverlay, overlay);
  try {
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      join(slideDirectory, backgroundName),
      "-i",
      temporaryOverlay,
      "-filter_complex",
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[background];[background][1:v]overlay=0:0",
      "-frames:v",
      "1",
      "-update",
      "1",
      join(slideDirectory, outputName),
    ]);
  } finally {
    await unlink(temporaryOverlay).catch(() => undefined);
  }
}

async function buildTerraformSlide() {
  const rows = [
    ["ARTIFACT REGISTRY", "Immutable container pinned by digest", "#8ab4f8"],
    ["CLOUD RUN", "Live serverless runtime · scale to zero", "#4f8df7"],
    ["SECRET MANAGER", "Two isolated CockroachDB credentials", "#ffca4b"],
    ["CLOUD STORAGE", "Private audit receipts · 30-day lifecycle", "#61d99f"],
    ["LEAST-PRIVILEGE IAM", "Only the access each component requires", "#c7a8ff"],
  ];
  const rowSvg = rows
    .map(
      ([label, detail, color], index) => `
        <g transform="translate(0 ${440 + index * 92})">
          <rect x="105" y="-42" width="14" height="58" rx="7" fill="${color}"/>
          <text x="145" y="-18" class="sans" fill="${color}" font-size="23" font-weight="800" letter-spacing="2">${escapeXml(label)}</text>
          <text x="145" y="14" class="sans" fill="#d9e6ff" font-size="25" font-weight="400">${escapeXml(detail)}</text>
        </g>`,
    )
    .join("");
  const overlay = svgDocument(`
    <rect width="1920" height="1080" fill="url(#shade)"/>
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#050b18" stop-opacity="0.96"/>
        <stop offset="0.58" stop-color="#071329" stop-opacity="0.72"/>
        <stop offset="1" stop-color="#061020" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    <text x="105" y="105" class="sans" fill="#59c8ff" font-size="24" font-weight="800" letter-spacing="6">LIVE GOOGLE CLOUD EDITION</text>
    <text x="105" y="205" class="sans" fill="#ffffff" font-size="70" font-weight="800">Terraform makes the weave</text>
    <text x="105" y="282" class="sans" fill="#ffffff" font-size="70" font-weight="800">reproducible.</text>
    <text x="108" y="342" class="sans" fill="#aebfdd" font-size="28">One reviewed plan declares every GCP layer.</text>
    ${rowSvg}
    <rect x="105" y="970" width="830" height="2" fill="#536a9b"/>
    <text x="105" y="1025" class="mono" fill="#bca7ff" font-size="25" letter-spacing="3">PLAN  ·  REVIEW  ·  APPLY  ·  VERIFY NO DRIFT</text>
  `);
  await compositeSlide(
    "gcp-terraform-art.png",
    overlay,
    "gcp-terraform-slide.png",
  );
}

async function buildEndCard() {
  const overlay = svgDocument(`
    <rect width="1920" height="1080" fill="url(#shade)"/>
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#09051f" stop-opacity="0.98"/>
        <stop offset="0.55" stop-color="#13072b" stop-opacity="0.72"/>
        <stop offset="1" stop-color="#16062c" stop-opacity="0.08"/>
      </linearGradient>
    </defs>
    <rect x="110" y="150" width="54" height="5" rx="2" fill="#29d9ff"/>
    <text x="110" y="205" class="sans" fill="#29d9ff" font-size="26" font-weight="800" letter-spacing="7">CONTACT US</text>
    <text x="110" y="320" class="sans" fill="#ffffff" font-size="74" font-weight="850">HelixCTW on</text>
    <text x="110" y="402" class="sans" fill="#ffffff" font-size="74" font-weight="850">Google Cloud.</text>
    <text x="110" y="510" class="sans" fill="#29d9ff" font-size="36" font-weight="800">@realjohnny5i</text>
    <text x="435" y="510" class="sans" fill="#a9b5d5" font-size="25">on X</text>
    <text x="110" y="598" class="sans" fill="#c193ff" font-size="38" font-weight="750">helixctw.com</text>
    <text x="110" y="675" class="sans" fill="#9b70ff" font-size="36" font-weight="750">didz.io</text>
    <text x="110" y="752" class="sans" fill="#ffd447" font-size="36" font-weight="750">enterprisezk.com</text>
    <text x="110" y="875" class="sans" fill="#c8d0e8" font-size="25">Live TestWired software · Synthetic data only</text>
    <text x="110" y="920" class="sans" fill="#9da8c8" font-size="22">Midnight adapter: SOURCE_ONLY</text>
    <rect x="110" y="978" width="900" height="2" fill="#504077"/>
    <text x="110" y="1030" class="mono" fill="#d5caff" font-size="23" letter-spacing="2">GOOGLE CLOUD  ·  TERRAFORM  ·  COCKROACHDB  ·  MIDNIGHT</text>
  `);
  await compositeSlide(
    "midnight-dude-bg.png",
    overlay,
    "gcp-midnight-contact-slide.png",
  );
}

await Promise.all([buildTerraformSlide(), buildEndCard()]);
console.log("Built GCP Terraform and Midnight contact slides.");
