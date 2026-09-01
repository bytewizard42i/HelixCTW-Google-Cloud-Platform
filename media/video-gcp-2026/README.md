# HelixCTW Google Cloud TestWired video (2026-09-01)

Outputs (git-ignored; large binaries stay out of Git):

- `media/videos/HelixCTW_GoogleCloud_TestWired_2026.mp4` — 2:58, Charon
  narration + the HelixCTW Suno theme as a quiet, voice-ducked bed
- `media/videos/HelixCTW_GoogleCloud_TestWired_2026_VoiceOnly.mp4` — clean
  narration-only master for future remixes

## Provenance

| Element | Source |
|---|---|
| Live footage | Headless Chromium screencast of <https://helixctw-gcp-testwired.vercel.app> (release `ebd1822`), real seven-checkpoint runs — no simulated UI |
| Narration | Gemini `gemini-3.1-flash-tts-preview`, voice Charon (AI-generated) |
| Music | `MidnightHelixCTW/media/sound/HelixCTW-suno song-1.mp3` (Suno, AI-generated, project-owned) |
| Terraform slide art | Gemini `gemini-3-pro-image` (AI-generated), exact text composited via SVG |
| End card art | Midnight-dude background from the CryptoSure contact slide (Gemini, AI-generated) |
| Vision slides | Not used in this cut; available in `MidnightHelixCTW/docs/media/vision-deck/` |

Honesty notes: provider labels shown on screen are the deployed truth (GCP +
CockroachDB `REALDEAL_TEST`; Midnight `SOURCE_ONLY`; fixtures `MOCK`). The
narration says Midnight is source-only. Disclose AI-generated narration, music,
and artwork when publishing.

## Reproduce

```bash
# 1. capture live scenes (temporary puppeteer workspace, see scripts)
node record.mjs && node record-hero.mjs && node record-receipt.mjs
# 2. narration clips
python3 gen_narration.py
# 3. slides (ffmpeg SVG compositing, no extra dependencies)
node build-slides.mjs
# 4. final assembly (segment timing, voice track, ducked music bed)
bash assemble.sh
```

The music bed uses `sidechaincompress` keyed by the narration: whenever the
voice speaks — or the song swells — the music is pushed down automatically.
