import { describe, expect, it } from "vitest";
import { mapEvent } from "../src/engine.js";
import { extractToken } from "../src/auth.js";
import type { BeaconEvent } from "@beacon/protocol";

const event: BeaconEvent = {
  event_id: "e1",
  event_type: "product.viewed",
  ts: new Date().toISOString(),
  session_id: "s1",
  client_id: "c1",
  page_num: 2,
  landing_product_id: "p_landing",
  props: { product_id: "p1", path: "/products/p1", title: "Fixture Product", quantity: 3, price: 10 },
};

describe("mapEvent", () => {
  it("maps canonical fields onto AE columns", () => {
    const m = mapEvent("store_1", event, "hash1");
    expect(m.indexes).toEqual(["store_1"]);
    expect(m.blobs[0]).toBe("product.viewed");
    expect(m.blobs[1]).toBe("p1");
    expect(m.blobs[2]).toBe("s1");
    expect(m.blobs[3]).toBe("hash1");
    expect(m.blobs[4]).toBe("p_landing");
    expect(m.blobs[5]).toBe("/products/p1");
    expect(m.doubles).toEqual([2, 3]);
  });

  it("defaults missing optionals to empty/zero", () => {
    const m = mapEvent("store_1", { ...event, landing_product_id: null, props: {} }, "h");
    expect(m.blobs[1]).toBe("");
    expect(m.blobs[4]).toBe("");
    expect(m.blobs[5]).toBe("");
    expect(m.doubles).toEqual([2, 0]);
  });

  it("clips oversized index values to 96 bytes", () => {
    const m = mapEvent("s".repeat(500), event, "h");
    expect(new TextEncoder().encode(m.indexes[0]).length).toBeLessThanOrEqual(96);
  });

  it("maps product title to blob7", () => {
    const m = mapEvent("store_1", event, "hash1");
    expect(m.blobs[6]).toBe("Fixture Product");
  });
});

describe("extractToken", () => {
  it("prefers the Authorization header", () => {
    expect(extractToken("Bearer tok1", "tok2")).toBe("tok1");
  });

  it("falls back to the body token for beacon clients", () => {
    expect(extractToken(null, "tok2")).toBe("tok2");
    expect(extractToken("", { token: 42 })).toBeNull();
  });

  it("returns null when nothing usable is present", () => {
    expect(extractToken(null, null)).toBeNull();
    expect(extractToken("Basic abc", "x")).toBe("x");
  });
});
