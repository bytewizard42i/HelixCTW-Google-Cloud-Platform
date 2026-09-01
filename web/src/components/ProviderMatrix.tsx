import type { EvidenceLabel } from "../api/types";
import { StatusBadge } from "./StatusBadge";

export interface ProviderDisplay {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly evidence: EvidenceLabel;
  readonly connection: string;
}

interface ProviderMatrixProps {
  readonly providers: readonly ProviderDisplay[];
}

export function ProviderMatrix({ providers }: ProviderMatrixProps) {
  return (
    <section className="provider-panel" aria-labelledby="provider-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Truth boundary</p>
          <h2 id="provider-heading">Every provider shows its work</h2>
        </div>
        <p className="section-note">No silent mock fallback</p>
      </div>

      <div className="provider-grid">
        {providers.map((provider) => (
          <article
            className="provider-card"
            key={provider.id}
            data-narration-key="providers"
            tabIndex={0}
          >
            <div className="provider-card__topline">
              <h3>{provider.name}</h3>
              <StatusBadge label={provider.evidence} compact />
            </div>
            <p>{provider.role}</p>
            <span className="provider-card__connection">{provider.connection}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
