type LruEntry = { etag: string; body: Uint8Array };

/**
 * Cache mémoire par instance (serverless : effet local à la lambda / process).
 * Réduit les hits Postgres pour les mêmes tuiles sous charge.
 */
export class MatchingV5MvtTileLru {
  private readonly maxEntries: number;
  private readonly map = new Map<string, LruEntry>();

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string): LruEntry | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, etag: string, body: Uint8Array): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { etag, body: Uint8Array.from(body) });
    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
}
