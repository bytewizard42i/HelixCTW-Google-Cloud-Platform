export const NARRATION_DWELL_MILLISECONDS = 650;

export const GUIDED_NARRATION = {
  overview:
    "Welcome to the Helix C T W test-wired demo. All results come from real test APIs for the protocol.",
  case:
    "This is a fictional TestTown property. The permitted question is whether it is unencumbered. No deed text belongs in the agent's model context.",
  connection:
    "This status comes from the configured API. Reachable does not mean ready, and disconnected providers keep every operational control locked.",
  checkpoint:
    "Each checkpoint advances only after the API returns the identifiers required for that operation.",
  evidence:
    "The evidence drawer shows only allowlisted fields returned by the API. Missing service evidence stays marked not available.",
  providers:
    "Each provider reports evidence and connection separately. Mock identity fixtures never become live merely because the Google Cloud front door responds.",
  narrator:
    "Narration passes only this curated guide copy to your browser or operating system's speech service. It opens no microphone. The selected voice may be local or remote.",
} as const;

export type NarrationKey = keyof typeof GUIDED_NARRATION;

export interface NarrationVoiceDescriptor {
  readonly name: string;
  readonly lang: string;
  readonly localService?: boolean;
  readonly default?: boolean;
}

export function isNarrationKey(value: string): value is NarrationKey {
  return Object.prototype.hasOwnProperty.call(GUIDED_NARRATION, value);
}

function normalizedLanguage(language: string): string {
  return language.replace("_", "-").toLowerCase();
}

function isBritishEnglish(language: string): boolean {
  return language === "en-gb" || language === "en-uk";
}

function voicePreferenceScore(voice: NarrationVoiceDescriptor): number {
  const language = normalizedLanguage(voice.lang);
  if (isBritishEnglish(language)) {
    return voice.localService ? 800 : 600;
  }
  if (language.startsWith("en-") || language === "en") {
    return voice.localService ? 700 : 500;
  }
  if (voice.default) {
    return voice.localService ? 400 : 300;
  }
  return voice.localService ? 200 : 100;
}

export function selectNarrationVoice<VoiceType extends NarrationVoiceDescriptor>(
  voices: readonly VoiceType[],
): VoiceType | null {
  let selectedVoice: VoiceType | null = null;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const voice of voices) {
    const score = voicePreferenceScore(voice);
    if (score > selectedScore) {
      selectedVoice = voice;
      selectedScore = score;
    }
  }
  return selectedVoice;
}

export function narrationVoiceLabel(
  voice: NarrationVoiceDescriptor | null,
): string {
  if (!voice) {
    return "No installed voice reported; British English requested";
  }
  const language = normalizedLanguage(voice.lang);
  const serviceLabel = voice.localService
    ? "Local"
    : "Browser-reported remote";
  if (isBritishEnglish(language)) {
    return `${serviceLabel} British English voice: ${voice.name}`;
  }
  if (language.startsWith("en")) {
    return `${serviceLabel} English fallback voice: ${voice.name}`;
  }
  return `${serviceLabel} system fallback voice: ${voice.name}`;
}
