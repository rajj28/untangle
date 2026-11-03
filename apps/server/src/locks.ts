export class KeyedLock {
  private readonly chains = new Map<string, Promise<void>>();

  // Scaling beyond one server instance requires a database lease per key.
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.chains.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.chains.get(key) === current) this.chains.delete(key);
    }
  }
}
