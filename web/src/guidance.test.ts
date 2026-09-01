import { describe, expect, it } from "vitest";
import {
  GUIDED_NARRATION,
  isNarrationKey,
  NARRATION_DWELL_MILLISECONDS,
  narrationVoiceLabel,
  selectNarrationVoice,
} from "./guidance";

describe("guided narration policy", () => {
  it("uses the required 650 millisecond hover and focus dwell", () => {
    expect(NARRATION_DWELL_MILLISECONDS).toBe(650);
  });

  it("accepts only curated narration keys and discloses speech-service scope", () => {
    expect(isNarrationKey("evidence")).toBe(true);
    expect(isNarrationKey("api-response-body")).toBe(false);
    expect(Object.keys(GUIDED_NARRATION)).not.toContain("protected-data");
    expect(GUIDED_NARRATION.narrator).toContain("local or remote");
  });

  it("prefers a local British English voice", () => {
    const voice = selectNarrationVoice([
      { name: "Default", lang: "en-US", localService: true, default: true },
      { name: "British Remote", lang: "en-GB", localService: false },
      { name: "British Local", lang: "en-GB", localService: true },
    ]);

    expect(voice?.name).toBe("British Local");
    expect(narrationVoiceLabel(voice)).toBe(
      "Local British English voice: British Local",
    );
  });

  it("prefers local English over a remote British voice", () => {
    const voice = selectNarrationVoice([
      { name: "British Remote", lang: "en-GB", localService: false },
      { name: "English Local", lang: "en-US", localService: true },
    ]);

    expect(voice?.name).toBe("English Local");
    expect(narrationVoiceLabel(voice)).toBe(
      "Local English fallback voice: English Local",
    );
  });

  it("recognizes the en-UK alias as British English", () => {
    const voice = selectNarrationVoice([
      { name: "US English", lang: "en-US", localService: true },
      { name: "British Alias", lang: "en-UK", localService: true },
    ]);

    expect(voice?.name).toBe("British Alias");
    expect(narrationVoiceLabel(voice)).toBe(
      "Local British English voice: British Alias",
    );
  });

  it("labels remote, non-British, and unavailable voices honestly", () => {
    expect(
      narrationVoiceLabel({
        name: "English Remote",
        lang: "en-US",
        localService: false,
      }),
    ).toBe("Browser-reported remote English fallback voice: English Remote");
    expect(narrationVoiceLabel(null)).toBe(
      "No installed voice reported; British English requested",
    );
  });
});
