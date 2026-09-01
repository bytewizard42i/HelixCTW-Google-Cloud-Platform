import { describe, expect, it } from "vitest";
import { LatestRequestGate, SynchronousOperationGate } from "./asyncGuards";

describe("SynchronousOperationGate", () => {
  it("rejects a rapid second activation until the first operation ends", () => {
    const operationGate = new SynchronousOperationGate();

    expect(operationGate.tryBegin()).toBe(true);
    expect(operationGate.tryBegin()).toBe(false);
    expect(operationGate.isActive()).toBe(true);

    operationGate.end();
    expect(operationGate.tryBegin()).toBe(true);
  });
});

describe("LatestRequestGate", () => {
  it("rejects an older status result after a newer check begins", () => {
    const requestGate = new LatestRequestGate();
    const olderGeneration = requestGate.begin();
    expect(requestGate.current()).toBe(olderGeneration);
    const newerGeneration = requestGate.begin();

    expect(requestGate.isCurrent(olderGeneration)).toBe(false);
    expect(requestGate.isCurrent(newerGeneration)).toBe(true);
    expect(requestGate.current()).toBe(newerGeneration);
  });

  it("invalidates the active generation during cleanup", () => {
    const requestGate = new LatestRequestGate();
    const activeGeneration = requestGate.begin();
    requestGate.invalidate();

    expect(requestGate.isCurrent(activeGeneration)).toBe(false);
  });

  it("keeps a stale speech callback from changing a newer utterance", () => {
    const utteranceGate = new LatestRequestGate();
    const canceledUtterance = utteranceGate.begin();
    const replacementUtterance = utteranceGate.begin();
    let speaking = true;

    if (utteranceGate.isCurrent(canceledUtterance)) {
      speaking = false;
    }
    expect(speaking).toBe(true);

    if (utteranceGate.isCurrent(replacementUtterance)) {
      speaking = false;
    }
    expect(speaking).toBe(false);
  });
});
