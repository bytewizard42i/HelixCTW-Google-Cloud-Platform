import { describe, expect, it } from "vitest";

import type {
  ApiResponseEnvelope,
  CreateRunResponse,
} from "./api/types";
import { validateCheckpointResponseEvidence } from "./responseEvidence";

const RELEASE_COMMIT = "f95112a79ffc2d15759784e11912448100da5e78";
const REQUEST_ID = "35d03c97-726c-4eff-b7b8-c69860121105";

/**
 * Regression guard for the GCP port's public create-run envelope. The values
 * are synthetic public identifiers shaped exactly like the live Cloud Run
 * response; no database row, credential, or protected field is copied here.
 */
describe("GCP live envelope compatibility", () => {
  it("accepts the canonical create-run response at checkpoint one", () => {
    const response: ApiResponseEnvelope<CreateRunResponse> = {
      data: {
        schemaVersion: "mhelixctw/api/v1",
        ok: true,
        requestId: REQUEST_ID,
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        protectedFieldsReturned: 0,
        runId: "b5f7bb0c-33ec-48fd-9265-18e327c92eb5",
        scenarioId: "morrow-farmhouse-testwired-v1",
        session: {
          sessionId: "7ca4e150-76a5-4f2f-8bc5-8de3c442f8e3",
          ordinal: "A",
          state: "OPEN",
          createdAt: "2026-09-01T14:12:03.463Z",
        },
      },
      httpStatus: 201,
      headerRequestId: REQUEST_ID,
      requestId: REQUEST_ID,
      receivedAt: "2026-09-01T14:12:03.500Z",
    };

    const decision = validateCheckpointResponseEvidence(
      0,
      response,
      null,
      RELEASE_COMMIT,
    );
    expect(decision.valid).toBe(true);
  });
});
