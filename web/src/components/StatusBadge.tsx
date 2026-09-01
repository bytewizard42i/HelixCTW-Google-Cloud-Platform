import type { EvidenceLabel } from "../api/types";

interface StatusBadgeProps {
  readonly label: EvidenceLabel | "TESTWIRED" | "NOT CONNECTED" | "CHECKING";
  readonly compact?: boolean;
}

function toneForLabel(label: StatusBadgeProps["label"]): string {
  if (
    label === "LIVE TESTWIRED" ||
    label === "REALDEAL TEST" ||
    label === "TESTWIRED"
  ) {
    return "live";
  }
  if (label === "MOCK") {
    return "mock";
  }
  if (label === "NOT CONNECTED" || label === "NOT AVAILABLE") {
    return "offline";
  }
  if (label === "CHECKING") {
    return "checking";
  }
  return "source";
}

export function StatusBadge({ label, compact = false }: StatusBadgeProps) {
  return (
    <span
      className={`status-badge status-badge--${toneForLabel(label)}${compact ? " status-badge--compact" : ""}`}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
