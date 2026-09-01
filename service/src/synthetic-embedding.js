// SPDX-License-Identifier: Apache-2.0
//
// mhelixctw-synthetic-embedding-v1: a deterministic, offline, eight-dimensional
// embedding generator for the TestWired judge scenario.
//
// EVIDENCE LABEL: MOCK, always. This is fixture code. It does NOT call a
// machine-learning model, and it produces no semantic understanding. It is a
// reproducible stand-in that lets CockroachDB distributed vector indexing be
// exercised honestly with public-safe synthetic text.
//
// It is deliberately NOT an AWS (Amazon Web Services) Bedrock Titan
// identifier: Amazon Titan Text Embeddings V2 emits 256, 512, or 1,024
// dimensions, never eight, so naming Titan here would be false.
//
// What IS real about the downstream story: the storage, the vector distance
// computation, the index, the retrieval, and the durable receipts are real
// CockroachDB behavior once the migration is applied. Only the vector's
// *origin* is a fixture.

import { createHash } from "node:crypto";

/** The exact model identifier pinned by migration 002's CHECK constraint. */
export const SYNTHETIC_EMBEDDING_MODEL_ID = "mhelixctw-synthetic-embedding-v1";

/** The exact dimension pinned by migration 002 (`VECTOR(8)`). */
export const SYNTHETIC_EMBEDDING_DIMENSIONS = 8;

/** Longest public-safe fixture text accepted. Keeps inputs bounded. */
export const MAX_EMBEDDING_INPUT_LENGTH = 512;

/**
 * Domain separator for the embedding commitment preimage. Domain separation
 * stops a commitment from being reinterpreted in another context.
 */
const COMMITMENT_DOMAIN = "mhelixctw/synthetic-embedding/v1";

/**
 * Canonicalize public-safe fixture text so the same logical input always
 * produces byte-identical bytes, and therefore an identical vector and
 * commitment on every machine.
 *
 * Rules: Unicode NFC, tabs and newlines are rejected rather than silently
 * rewritten, runs of spaces collapse to one, and the result is trimmed.
 */
export function canonicalizeEmbeddingInput(rawInput) {
  if (typeof rawInput !== "string") {
    throw new TypeError("embedding input must be a string");
  }
  const normalized = rawInput.normalize("NFC");
  // Reject control characters outright. Silently stripping them would let two
  // different inputs collapse into one vector, which would be dishonest.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new RangeError("embedding input must not contain control characters");
  }
  const collapsed = normalized.replace(/ {2,}/g, " ").trim();
  if (collapsed.length === 0) {
    throw new RangeError("embedding input must not be empty");
  }
  if (collapsed.length > MAX_EMBEDDING_INPUT_LENGTH) {
    throw new RangeError(
      `embedding input must be at most ${MAX_EMBEDDING_INPUT_LENGTH} characters`,
    );
  }
  return collapsed;
}

/**
 * Format one vector component canonically: fixed 12-decimal notation, with
 * negative zero normalized away. Text formatting must be stable, because the
 * commitment is computed over it.
 */
function formatComponent(component) {
  const fixed = component.toFixed(12);
  return fixed === "-0.000000000000" ? "0.000000000000" : fixed;
}

/**
 * Derive the eight-dimensional unit vector for one canonical input.
 *
 * Method: SHA-512 over the domain-separated model and input gives 64 bytes.
 * Each of the eight components consumes four bytes as an unsigned 32-bit
 * big-endian integer mapped into [-1, 1). The vector is then unit normalized,
 * because cosine distance compares direction only, and normalized vectors are
 * the documented ideal case for the cosine operator class.
 */
function deriveUnitVector(canonicalInput) {
  const digest = createHash("sha512")
    .update(`${COMMITMENT_DOMAIN}\n${SYNTHETIC_EMBEDDING_MODEL_ID}\n${canonicalInput}`, "utf8")
    .digest();

  const rawComponents = [];
  for (let index = 0; index < SYNTHETIC_EMBEDDING_DIMENSIONS; index += 1) {
    const unsigned = digest.readUInt32BE(index * 4);
    rawComponents.push(unsigned / 2147483648 - 1);
  }

  const magnitude = Math.sqrt(
    rawComponents.reduce((total, component) => total + component * component, 0),
  );
  // A zero vector has no direction, so cosine distance would be undefined.
  // With SHA-512 input this is astronomically unlikely, but it must fail loudly
  // rather than produce a meaningless vector.
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new RangeError("derived embedding is a zero or non-finite vector");
  }

  const unitVector = rawComponents.map((component) => {
    const normalizedComponent = component / magnitude;
    if (!Number.isFinite(normalizedComponent)) {
      throw new RangeError("derived embedding component is not finite");
    }
    // Round to the canonical text precision so the stored vector and the
    // committed vector are the same numbers, not merely close ones.
    return Number.parseFloat(formatComponent(normalizedComponent));
  });

  return unitVector;
}

/**
 * Compute the 32-byte commitment binding the model identifier, the canonical
 * public-safe input, and the canonical vector together. Storing this alongside
 * the vector lets a receipt prove which input produced which vector without
 * republishing the vector.
 */
export function computeEmbeddingCommitmentHex(canonicalInput, unitVector) {
  const preimage = [
    `domain=${COMMITMENT_DOMAIN}`,
    `model=${SYNTHETIC_EMBEDDING_MODEL_ID}`,
    `dimensions=${SYNTHETIC_EMBEDDING_DIMENSIONS}`,
    `input=${canonicalInput}`,
    `vector=${unitVector.map(formatComponent).join(",")}`,
  ].join("\n");
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

/**
 * Generate the complete deterministic embedding record for one public-safe
 * fixture string.
 *
 * Returns the canonical input, the eight-dimensional unit vector, the
 * commitment, and the fixed model metadata. Always `MOCK`.
 */
export function generateSyntheticEmbedding(rawInput) {
  const canonicalInput = canonicalizeEmbeddingInput(rawInput);
  const embedding = deriveUnitVector(canonicalInput);
  return {
    modelId: SYNTHETIC_EMBEDDING_MODEL_ID,
    dimensions: SYNTHETIC_EMBEDDING_DIMENSIONS,
    evidence: "MOCK",
    canonicalInput,
    embedding,
    embeddingCommitmentHex: computeEmbeddingCommitmentHex(
      canonicalInput,
      embedding,
    ),
  };
}

/**
 * Validate an embedding that arrived from storage or another process before it
 * is trusted. Fails closed on the wrong dimension, a non-finite value, a zero
 * vector, or a vector that is not unit length.
 */
export function assertValidEmbedding(embedding) {
  if (!Array.isArray(embedding)) {
    throw new TypeError("embedding must be an array");
  }
  if (embedding.length !== SYNTHETIC_EMBEDDING_DIMENSIONS) {
    throw new RangeError(
      `embedding must have exactly ${SYNTHETIC_EMBEDDING_DIMENSIONS} dimensions`,
    );
  }
  let sumOfSquares = 0;
  for (const component of embedding) {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      throw new RangeError("embedding components must be finite numbers");
    }
    sumOfSquares += component * component;
  }
  if (sumOfSquares === 0) {
    throw new RangeError("embedding must not be a zero vector");
  }
  // Allow a small tolerance for the canonical 12-decimal rounding above.
  if (Math.abs(Math.sqrt(sumOfSquares) - 1) > 1e-9) {
    throw new RangeError("embedding must be unit normalized");
  }
  return true;
}

/** Render a vector in CockroachDB `VECTOR` literal form, for example `[a,b,...]`. */
export function toVectorLiteral(embedding) {
  assertValidEmbedding(embedding);
  return `[${embedding.map(formatComponent).join(",")}]`;
}
