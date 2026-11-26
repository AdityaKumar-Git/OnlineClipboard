/**
 * Minimal in-memory stand-in for the ioredis commands the app uses, with real TTL expiry.
 * Only what the services call is implemented.
 */
export class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    let ttl: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX') ttl = Number(args[++i]);
      else if (arg === 'NX') nx = true;
    }
    if (nx && this.live(key)) return null;
    this.store.set(key, { value, expiresAt: ttl === null ? null : Date.now() + ttl * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.live(key) && this.store.delete(key)) n++;
    return n;
  }

  async incr(key: string): Promise<number> {
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  /** Test helper: forget everything. */
  flush() {
    this.store.clear();
  }

  /** Test helper: drop a key as if its TTL had run out. */
  expireNow(key: string) {
    this.store.delete(key);
  }
}
