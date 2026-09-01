import { useEffect, useRef } from "react";
import type {
  EvidenceDisplayFieldId,
  EvidenceDisplayFields,
} from "../receiptEvidence";
import { StatusBadge } from "./StatusBadge";

export interface EvidenceSnapshot {
  readonly operation: string;
  readonly httpStatus: number;
  readonly receivedAt: string;
  readonly fields: EvidenceDisplayFields;
}

interface EvidenceDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly evidence: EvidenceSnapshot | null;
  readonly onFetchReceipt: (() => Promise<void>) | null;
  readonly fetchingReceipt: boolean;
}

const EVIDENCE_ROWS: readonly {
  readonly label: string;
  readonly field: EvidenceDisplayFieldId;
}[] = [
  { label: "Current API response request", field: "apiRequestId" },
  { label: "Build stage", field: "buildStage" },
  { label: "Deployment evidence", field: "deploymentEvidence" },
  { label: "Release commit", field: "releaseCommit" },
  { label: "Run", field: "runId" },
  { label: "Scenario", field: "scenarioId" },
  { label: "Receipt operation", field: "receiptOperation" },
  { label: "Receipt created", field: "receiptCreatedAt" },
  { label: "Session", field: "sessionId" },
  { label: "Canonical memory", field: "canonicalMemoryId" },
  { label: "Semantic distance", field: "semanticDistance" },
  { label: "Evidence commitment", field: "evidenceCommitment" },
  { label: "Midnight receipt", field: "midnightReceiptId" },
  { label: "Projection generation", field: "projectionGenerationId" },
  { label: "Operation receipt", field: "receiptId" },
  { label: "Protected fields returned", field: "protectedFieldsReturned" },
  { label: "Managed MCP verification", field: "managedMcpReceiptId" },
];

export function EvidenceDrawer({
  open,
  onClose,
  evidence,
  onFetchReceipt,
  fetchingReceipt,
}: EvidenceDrawerProps) {
  const dialogReference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogReference.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      className="evidence-drawer"
      ref={dialogReference}
      onClose={onClose}
      aria-labelledby="evidence-drawer-title"
    >
      <div className="evidence-drawer__header">
        <div>
          <p className="eyebrow">Read-only evidence</p>
          <h2 id="evidence-drawer-title">What the API actually returned</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Close evidence drawer</span>
        </button>
      </div>

      <p className="evidence-drawer__boundary">
        Only exact, runtime-validated canonical fields are displayed. A field
        stays <strong>NOT AVAILABLE</strong> until the matching API response
        supplies it at its reviewed path.
      </p>

      <dl className="evidence-list">
        {EVIDENCE_ROWS.map((row) => {
          const value = evidence?.fields[row.field];
          return (
            <div
              className="evidence-list__row"
              key={row.field}
              data-narration-key="evidence"
              tabIndex={0}
            >
              <dt>{row.label}</dt>
              <dd>
                {value === undefined || value === null ? (
                  <StatusBadge label="NOT AVAILABLE" compact />
                ) : (
                  <code>{String(value)}</code>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="evidence-drawer__footer">
        <p>
          {evidence
            ? `${evidence.operation} · HTTP ${evidence.httpStatus} · ${evidence.receivedAt}`
            : "No operational API response has been received in this browser session."}
        </p>
        <button
          className="button button--secondary"
          type="button"
          disabled={!onFetchReceipt || fetchingReceipt}
          onClick={() => void onFetchReceipt?.()}
        >
          {fetchingReceipt ? "Retrieving receipt…" : "Retrieve receipt from API"}
        </button>
      </div>
    </dialog>
  );
}
