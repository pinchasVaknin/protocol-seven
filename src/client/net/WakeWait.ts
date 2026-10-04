/**
 * Questions about a remote body that cannot be answered yet, asked again until they can
 * (anti-wallhack phase 2, part 1).
 *
 * A body this client is not told about is dormant and has no place to measure from. When one
 * hurts the player, the server tells this client about it at once (R9, `SeatView.reveal`) — but
 * the damage rides the event frame of the tick it happened on, and the snapshot that wakes the
 * shooter is the next one out, up to a snapshot interval later. So a question about the shooter
 * — where to point the chevron, how far away the killer was — waits for that snapshot rather than
 * giving up on the frame the damage arrived.
 */

/**
 * How long to keep asking: a snapshot interval (50 ms at 20 Hz), a lost snapshot behind it, the
 * link's jitter, and a frame. Past this the body is genuinely unknown — a range dummy, a player
 * who left — and the answer is the old one: nothing.
 */
export const WAKE_WAIT_MS = 300;

export class WakeWait {
  private readonly ids: number[] = [];
  private readonly deadlines: number[] = [];

  /** `capacity` questions at once; past it, the oldest is dropped for the newest. */
  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.ids.length;
  }

  /** Ask about `entityId` until `nowMs + WAKE_WAIT_MS`. Asking again only extends the wait. */
  add(entityId: number, nowMs: number): void {
    const deadline = nowMs + WAKE_WAIT_MS;
    const at = this.ids.indexOf(entityId);
    if (at >= 0) {
      this.deadlines[at] = deadline;
      return;
    }
    if (this.ids.length >= this.capacity) {
      this.ids.shift();
      this.deadlines.shift();
    }
    this.ids.push(entityId);
    this.deadlines.push(deadline);
  }

  /**
   * Ask every waiting question once. `answer` returns true when it could act on the body, and
   * that question is done; one past its deadline is dropped unanswered.
   */
  poll(nowMs: number, answer: (entityId: number) => boolean): void {
    for (let i = this.ids.length - 1; i >= 0; i--) {
      const id = this.ids[i];
      const deadline = this.deadlines[i];
      if (id === undefined || deadline === undefined) continue;
      if (answer(id) || nowMs > deadline) {
        this.ids.splice(i, 1);
        this.deadlines.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.ids.length = 0;
    this.deadlines.length = 0;
  }
}
