import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  GUIDED_NARRATION,
  isNarrationKey,
  NARRATION_DWELL_MILLISECONDS,
  narrationVoiceLabel,
  selectNarrationVoice,
  type NarrationKey,
} from "../guidance";
import { LatestRequestGate } from "../asyncGuards";

const REPEAT_SUPPRESSION_MILLISECONDS = 30_000;
const HOVER_DWELL_MILLISECONDS = 1200;
const NARRATION_LOCK_MILLISECONDS = 8000;

function supportsBrowserNarration(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof globalThis.SpeechSynthesisUtterance === "function"
  );
}

function narrationKeyAtTarget(target: EventTarget | null): NarrationKey | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const narrationElement = target.closest<HTMLElement>("[data-narration-key]");
  const candidateKey = narrationElement?.dataset.narrationKey;
  return candidateKey && isNarrationKey(candidateKey) ? candidateKey : null;
}

export interface GuidedNarratorController {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly speaking: boolean;
  readonly voiceLabel: string;
  readonly lastKey: NarrationKey | null;
  readonly surfaceProps: {
    readonly onPointerOver: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerOut: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onFocusCapture: (event: ReactFocusEvent<HTMLElement>) => void;
    readonly onBlurCapture: (event: ReactFocusEvent<HTMLElement>) => void;
  };
  start(): void;
  enable(): void;
  disable(): void;
  replay(): void;
  stop(): void;
}

export function useGuidedNarrator(
  guideStarted: boolean,
): GuidedNarratorController {
  const [supported] = useState(supportsBrowserNarration);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [selectedVoice, setSelectedVoice] =
    useState<SpeechSynthesisVoice | null>(null);
  const [lastKey, setLastKey] = useState<NarrationKey | null>(null);
  const pendingTimerReference = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenKeyReference = useRef<NarrationKey | null>(null);
  const lastSpokenAtReference = useRef(0);
  const utteranceRequestGateReference = useRef(new LatestRequestGate());
  const narrationLockUntilReference = useRef(0);

  const clearPending = useCallback(() => {
    if (pendingTimerReference.current !== null) {
      globalThis.clearTimeout(pendingTimerReference.current);
      pendingTimerReference.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    utteranceRequestGateReference.current.invalidate();
    clearPending();
    if (supported) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [clearPending, supported]);

  useEffect(() => {
    if (!supported) {
      return undefined;
    }
    const speechSynthesis = window.speechSynthesis;
    const refreshVoices = () => {
      setSelectedVoice(selectNarrationVoice(speechSynthesis.getVoices()));
    };

    refreshVoices();
    speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => {
      utteranceRequestGateReference.current.invalidate();
      clearPending();
      speechSynthesis.cancel();
      speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
    };
  }, [clearPending, supported]);

  const speak = useCallback(
    (key: NarrationKey, force = false) => {
      if (!supported) {
        return;
      }
      const currentTime = Date.now();
      if (
        !force &&
        lastSpokenKeyReference.current === key &&
        currentTime - lastSpokenAtReference.current <
          REPEAT_SUPPRESSION_MILLISECONDS
      ) {
        return;
      }

      clearPending();
      const utteranceGeneration =
        utteranceRequestGateReference.current.begin();
      const speechSynthesis = window.speechSynthesis;
      speechSynthesis.cancel();
      const setSpeakingIfCurrent = (nextSpeaking: boolean) => {
        if (utteranceRequestGateReference.current.isCurrent(utteranceGeneration)) {
          setSpeaking(nextSpeaking);
        }
      };
      const utterance = new SpeechSynthesisUtterance(GUIDED_NARRATION[key]);
      utterance.lang = selectedVoice?.lang ?? "en-GB";
      utterance.rate = 1.6;
      utterance.pitch = 1;
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      utterance.onstart = () => setSpeakingIfCurrent(true);
      utterance.onend = () => setSpeakingIfCurrent(false);
      utterance.onerror = () => setSpeakingIfCurrent(false);
      lastSpokenKeyReference.current = key;
      lastSpokenAtReference.current = currentTime;
      narrationLockUntilReference.current = currentTime + NARRATION_LOCK_MILLISECONDS;
      setLastKey(key);
      speechSynthesis.speak(utterance);
    },
    [clearPending, selectedVoice, supported],
  );

  const schedule = useCallback(
    (key: NarrationKey) => {
      clearPending();
      if (!guideStarted || !enabled || !supported) {
        return;
      }
      // Don't interrupt active narration — wait for the lock to expire
      const now = Date.now();
      if (now < narrationLockUntilReference.current) {
        return;
      }
      if (lastSpokenKeyReference.current !== key) {
        utteranceRequestGateReference.current.invalidate();
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      pendingTimerReference.current = globalThis.setTimeout(() => {
        pendingTimerReference.current = null;
        speak(key);
      }, HOVER_DWELL_MILLISECONDS);
    },
    [clearPending, enabled, guideStarted, speak, supported],
  );

  const onPointerOver = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") {
        return;
      }
      const key = narrationKeyAtTarget(event.target);
      if (key && key !== narrationKeyAtTarget(event.relatedTarget)) {
        schedule(key);
      }
    },
    [schedule],
  );

  const onPointerOut = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        narrationKeyAtTarget(event.target) !==
        narrationKeyAtTarget(event.relatedTarget)
      ) {
        clearPending();
      }
    },
    [clearPending],
  );

  const onFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const key = narrationKeyAtTarget(event.target);
      if (key) {
        schedule(key);
      }
    },
    [schedule],
  );

  const onBlurCapture = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      if (
        narrationKeyAtTarget(event.target) !==
        narrationKeyAtTarget(event.relatedTarget)
      ) {
        clearPending();
      }
    },
    [clearPending],
  );

  const start = useCallback(() => {
    if (!supported) {
      return;
    }
    setEnabled(true);
    // Lock narration so hover events don't interrupt the welcome
    narrationLockUntilReference.current = Date.now() + NARRATION_LOCK_MILLISECONDS;
    speak("overview", true);
  }, [speak, supported]);

  const enable = useCallback(() => {
    if (supported) {
      setEnabled(true);
    }
  }, [supported]);

  const disable = useCallback(() => {
    setEnabled(false);
    stop();
  }, [stop]);

  const replay = useCallback(() => {
    if (enabled) {
      speak(lastSpokenKeyReference.current ?? "overview", true);
    }
  }, [enabled, speak]);

  const surfaceProps = useMemo(
    () => ({ onPointerOver, onPointerOut, onFocusCapture, onBlurCapture }),
    [onBlurCapture, onFocusCapture, onPointerOut, onPointerOver],
  );

  return {
    supported,
    enabled,
    speaking,
    voiceLabel: supported
      ? narrationVoiceLabel(selectedVoice)
      : "Narration unavailable in this browser",
    lastKey,
    surfaceProps,
    start,
    enable,
    disable,
    replay,
    stop,
  };
}
