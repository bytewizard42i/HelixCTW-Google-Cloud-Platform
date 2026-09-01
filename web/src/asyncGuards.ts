/**
 * Identifies the newest request in a family of replaceable reads. A late
 * response may finish, but it cannot overwrite the result of a newer request.
 */
export class SynchronousOperationGate {
  private operationInFlight = false;

  tryBegin(): boolean {
    if (this.operationInFlight) {
      return false;
    }
    this.operationInFlight = true;
    return true;
  }

  end(): void {
    this.operationInFlight = false;
  }

  isActive(): boolean {
    return this.operationInFlight;
  }
}

export class LatestRequestGate {
  private currentGeneration = 0;

  begin(): number {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  current(): number {
    return this.currentGeneration;
  }

  isCurrent(generation: number): boolean {
    return generation === this.currentGeneration;
  }

  invalidate(): void {
    this.currentGeneration += 1;
  }
}
