#!/usr/bin/env python3
"""Generate the seven fixed HelixCTW narration clips with Gemini Charon.

The script reads web/src/narration.json, so the spoken text and displayed
curated text cannot drift. It loads the Gemini key from the same private PixyPi
credential used by the image generator; the key is never printed or written to
the repository.

Gemini returns headerless signed 16-bit little-endian PCM at 24 kHz. ffmpeg
normalizes each clip to broadcast-style -16 LUFS and emits a mono 128 kbps MP3
under web/public/narration/. These are fixed public assets—not runtime API
results, identifiers, private data, or model reasoning.
"""

import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPOSITORY_ROOT / "web" / "src" / "narration.json"
OUTPUT_DIRECTORY = REPOSITORY_ROOT / "web" / "public" / "narration"
CREDENTIAL_PATH = Path.home() / "PixyPi" / ".mcp-credentials" / "gemini-api-key.json"
MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Charon"
EXPECTED_KEYS = {
    "overview",
    "case",
    "connection",
    "checkpoint",
    "evidence",
    "providers",
    "narrator",
}
STYLE = (
    "Speak in a warm, confident, polished documentary-narrator tone. "
    "Sound trustworthy and technically informed, with natural pacing and clear "
    "enunciation. Do not add, omit, or paraphrase words. Read exactly: "
)


def load_api_key() -> str:
    environment_key = os.environ.get("GEMINI_API_KEY")
    if environment_key:
        return environment_key
    with CREDENTIAL_PATH.open(encoding="utf-8") as credential_file:
        credentials = json.load(credential_file)
    api_key = (
        credentials.get("api_key")
        or credentials.get("GEMINI_API_KEY")
        or credentials.get("key")
    )
    if not isinstance(api_key, str) or not api_key:
        raise RuntimeError("The private Gemini credential does not contain an API key.")
    return api_key


def synthesize(api_key: str, text: str) -> tuple[bytes, str]:
    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}"
        f":generateContent?key={api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": STYLE + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": VOICE}
                }
            },
        },
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    inline_audio = result["candidates"][0]["content"]["parts"][0]["inlineData"]
    return base64.b64decode(inline_audio["data"]), inline_audio.get("mimeType", "")


def encode_mp3(pcm_audio: bytes, output_path: Path) -> None:
    with tempfile.NamedTemporaryFile(suffix=".pcm") as temporary_pcm:
        temporary_pcm.write(pcm_audio)
        temporary_pcm.flush()
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-f",
                "s16le",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-i",
                temporary_pcm.name,
                "-af",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ac",
                "1",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "128k",
                str(output_path),
            ],
            check=True,
        )


def main() -> None:
    with MANIFEST_PATH.open(encoding="utf-8") as manifest_file:
        narration = json.load(manifest_file)
    if set(narration) != EXPECTED_KEYS or not all(
        isinstance(text, str) and 1 <= len(text) <= 500 for text in narration.values()
    ):
        raise RuntimeError("Narration manifest keys or text bounds are invalid.")

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    api_key = load_api_key()
    for key, text in narration.items():
        output_path = OUTPUT_DIRECTORY / f"{key}.mp3"
        if output_path.exists():
            raise RuntimeError(f"Refusing to overwrite existing clip: {output_path}")
        pcm_audio, mime_type = synthesize(api_key, text)
        if "audio" not in mime_type.lower() or len(pcm_audio) < 1_000:
            raise RuntimeError(f"Gemini returned invalid audio for {key}.")
        encode_mp3(pcm_audio, output_path)
        digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
        print(f"{key}.mp3: {output_path.stat().st_size:,} bytes, sha256={digest}")

    print(f"Generated {len(narration)} clips with {MODEL} / {VOICE}.")


if __name__ == "__main__":
    main()
