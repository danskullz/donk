// Undo and redo for the Editor: the document is immutable, so history is a stack of earlier documents.
// A paint stroke changes the document many times; `begin` and `end` make the whole stroke one undo step.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private stroke: { before: T } | null = null;

  constructor(
    private current: T,
    private readonly limit = 200,
  ) {}

  get present(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** A finished change: it can be undone. */
  commit(next: T): T {
    if (next === this.current) return next;
    if (this.stroke) return this.replace(next);
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  /** Change the present without a history step, for the middle of a stroke. */
  replace(next: T): T {
    this.current = next;
    return next;
  }

  begin(): void {
    this.stroke ??= { before: this.current };
  }

  /** Close a stroke: one undo step if anything changed. */
  end(): T {
    const s = this.stroke;
    this.stroke = null;
    if (s && s.before !== this.current) {
      this.past.push(s.before);
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    return this.current;
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev === undefined) return this.current;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.current;
    this.past.push(this.current);
    this.current = next;
    return next;
  }
}
