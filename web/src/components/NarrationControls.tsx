import type { GuidedNarratorController } from "../hooks/useGuidedNarrator";

interface NarrationControlsProps {
  readonly guideStarted: boolean;
  readonly onStart: () => void;
  readonly narrator: GuidedNarratorController;
}

export function NarrationControls({
  guideStarted,
  onStart,
  narrator,
}: NarrationControlsProps) {
  return (
    <section
      className="guide-console"
      aria-label="Guided demonstration controls"
      data-narration-key="narrator"
    >
      <div className="guide-console__status" aria-live="polite">
        <span className="guide-console__pulse" aria-hidden="true" />
        <div>
          <strong>{guideStarted ? "Guided demo active" : "Guided demo ready"}</strong>
          <p>
            {narrator.voiceLabel}. No microphone. The browser or operating system
            may use a local or remote speech service.
          </p>
        </div>
      </div>

      <div className="guide-console__actions">
        {!guideStarted ? (
          <button className="button button--primary" type="button" onClick={onStart}>
            Start guided demo
          </button>
        ) : (
          <>
            <button
              className="button button--secondary"
              type="button"
              disabled={!narrator.supported}
              aria-pressed={narrator.enabled}
              onClick={narrator.enabled ? narrator.disable : narrator.enable}
            >
              Voice {narrator.enabled ? "on" : "off"}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={!narrator.supported || !narrator.enabled}
              onClick={narrator.replay}
            >
              Replay
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={!narrator.supported || !narrator.speaking}
              onClick={narrator.stop}
            >
              Stop
            </button>
          </>
        )}
      </div>
    </section>
  );
}
