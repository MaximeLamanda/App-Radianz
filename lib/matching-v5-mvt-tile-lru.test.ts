import { describe, expect, it } from "vitest";
import { MatchingV5MvtTileLru } from "@/lib/matching-v5-mvt-tile-lru";

describe("MatchingV5MvtTileLru", () => {
  it("retourne la dernière entrée pour une clé", () => {
    const lru = new MatchingV5MvtTileLru(10);
    lru.set("a", 'W/"1"', new Uint8Array([1]));
    lru.set("a", 'W/"2"', new Uint8Array([2]));
    expect(lru.get("a")?.body).toEqual(new Uint8Array([2]));
    expect(lru.get("a")?.etag).toBe('W/"2"');
  });

  it("évite de dépasser maxEntries", () => {
    const lru = new MatchingV5MvtTileLru(2);
    lru.set("k1", "e1", new Uint8Array([1]));
    lru.set("k2", "e2", new Uint8Array([2]));
    lru.set("k3", "e3", new Uint8Array([3]));
    expect(lru.get("k1")).toBeUndefined();
    expect(lru.get("k2")).toBeDefined();
    expect(lru.get("k3")).toBeDefined();
  });

  it("rafraîchit l’ordre LRU au get", () => {
    const lru = new MatchingV5MvtTileLru(2);
    lru.set("a", "ea", new Uint8Array([1]));
    lru.set("b", "eb", new Uint8Array([2]));
    expect(lru.get("a")).toBeDefined();
    lru.set("c", "ec", new Uint8Array([3]));
    expect(lru.get("a")).toBeDefined();
    expect(lru.get("b")).toBeUndefined();
  });
});
