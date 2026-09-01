#!/usr/bin/env python3
"""Generate the GCP video narration with Gemini Charon (raw PCM per line)."""
import base64
import json
import os
import urllib.request

CRED = os.path.expanduser("~/PixyPi/.mcp-credentials/gemini-api-key.json")
with open(CRED, encoding="utf-8") as f:
    c = json.load(f)
KEY = c.get("api_key") or c.get("GEMINI_API_KEY") or c.get("key")
assert KEY, "no API key found"

MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Charon"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}"
STYLE = ("Speak in a warm, confident, polished documentary-narrator tone, "
         "measured pace, clear enunciation. Read exactly: ")

LINES = {
    "n01": "This is HelixCTW on Google Cloud: a privacy-preserving memory and proof weave for AI agents. The same protocol moves across clouds without moving its trust boundary.",
    "n02": "Terraform declares the entire Google Cloud edition as reviewed code. Artifact Registry holds an immutable container. Cloud Run executes it. Secret Manager guards the database credentials, and Cloud Storage keeps the audit receipts. Plan, review, apply — then verify there is no drift.",
    "n03": "Google Cloud carries the live runtime. Midnight defines the privacy boundary: prove the permitted fact, never the private record. Every provider label on this page is earned evidence — Google Cloud and CockroachDB are live, and Midnight is honestly marked source-only until its network adapter earns promotion.",
    "n04": "Checkpoint one. The live API creates a bounded run for the fictional Morrow farmhouse, opening Session A inside a serializable CockroachDB transaction on Google Cloud Run.",
    "n05": "Checkpoint two. The browser forgets the conversation. Only bounded, public-safe memory survives — committed to CockroachDB with a durable receipt.",
    "n06": "Checkpoint three. A fresh session asks where the work stopped. CockroachDB's distributed vector index finds the memory by meaning — nothing was stored in this browser.",
    "n07": "Checkpoint four. The permitted question: is the property unencumbered? One authorized bit comes back — true. No deed, no mortgage, no owner identity. That is the Midnight principle in practice.",
    "n08": "Checkpoint five. An unauthorized agent demands every protected field. Denied — zero fields disclosed, and the refusal itself becomes a durable receipt. Memory never becomes permission.",
    "n09": "Checkpoints six and seven. The recall projection is rebuilt from the same canonical records, and the same question returns the same answer through the new generation. Continuity, verified.",
    "n10": "The final receipt binds everything to the original Google Cloud request. Cloud Run executes. CockroachDB remembers. Terraform reproduces. Midnight keeps the proof boundary narrow. HelixCTW: prove one thing, and nothing more.",
}

for name, line in LINES.items():
    payload = {
        "contents": [{"parts": [{"text": STYLE + line}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}},
        },
    }
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
    audio = base64.b64decode(part["data"])
    assert "audio" in part.get("mimeType", "").lower() and len(audio) > 1000, name
    with open(f"{name}.pcm", "wb") as out:
        out.write(audio)
    print(f"{name}.pcm {len(audio):,} bytes")
print("narration complete")
