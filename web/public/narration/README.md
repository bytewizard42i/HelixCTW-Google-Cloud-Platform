# HelixCTW narration assets

These seven MP3 files are AI-generated narration for the fixed, public-safe
strings in `web/src/narration.json`.

- Model: `gemini-3.1-flash-tts-preview`
- Voice: `Charon` (informative documentary narrator)
- Generated: 2026-09-01
- Processing: mono MP3, 128 kbps, normalized to -16 LUFS / -1.5 dBTP
- Reproduction: `python3 scripts/generate-narration.py`

The Gemini API key is read from the private PixyPi credential and is never
embedded in these files, the web bundle, or Git. Audio contains only curated
narration—never API responses, identifiers, model reasoning, or protected data.
Browser Web Speech remains the runtime fallback if a static clip cannot play.
