import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  LIMITS,
  validateBatch,
  validateEvent,
  type BeaconEvent,
} from "../src/index.js";

function baseEvent(overrides: Partial<BeaconEvent> = {}): BeaconEvent {
  return {
    event_id: "evt_0001",
    event_type: "page.viewed",
    ts: new Date().toISOString(),
    session_id: "sess_abc123",
    client_id: "client-xyz",
    page_num: 1,
    ...overrides,
  };
}

describe("validateEvent", () => {
  it("accepts a minimal valid event", () => {
    const r = validateEvent(baseEvent());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.event_type).toBe("page.viewed");
  });

  it("normalizes ts to ISO 8601", () => {
    const ts = new Date(Date.now() - 1000).toISOString();
    const r = validateEvent(baseEvent({ ts }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ts).toBe(ts);
  });

  it("rejects unknown event types", () => {
    const r = validateEvent({ ...baseEvent(), event_type: "shopify:weird" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("event_type");
  });

  it("rejects events outside the clock-skew window", () => {
    const stale = new Date(Date.now() - (LIMITS.TS_SKEW_SECONDS + 60) * 1000);
    const r = validateEvent(baseEvent({ ts: stale.toISOString() }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("clock-skew");
  });

  it("rejects future-dated events beyond the skew window", () => {
    const future = new Date(Date.now() + (LIMITS.TS_SKEW_SECONDS + 60) * 1000);
    const r = validateEvent(baseEvent({ ts: future.toISOString() }));
    expect(r.ok).toBe(false);
  });

  it("rejects ids with unexpected characters", () => {
    const r = validateEvent(baseEvent({ session_id: "bad id with spaces!" }));
    expect(r.ok).toBe(false);
  });

  it("rejects non-integer, sub-1 and oversized page_num", () => {
    for (const page_num of [0, 1.5, LIMITS.MAX_PAGE_NUM + 1, "1"]) {
      expect(validateEvent(baseEvent({ page_num: page_num as number })).ok).toBe(false);
    }
  });

  it("requires product_id for product.viewed and cart.added", () => {
    for (const event_type of ["product.viewed", "cart.added"] as const) {
      const r = validateEvent(baseEvent({ event_type }));
      expect(r.ok).toBe(false);
    }
    for (const event_type of ["product.viewed", "cart.added"] as const) {
      const r = validateEvent({
        ...baseEvent({ event_type }),
        props: { product_id: "p1" },
      });
      expect(r.ok).toBe(true);
    }
  });

  it("does not require product_id for page.viewed and checkout.started", () => {
    for (const event_type of ["page.viewed", "checkout.started"] as const) {
      expect(validateEvent(baseEvent({ event_type })).ok).toBe(true);
    }
  });

  it("uppercases currency and rejects bad codes", () => {
    const ok = validateEvent({ ...baseEvent(), props: { currency: "usd", price: 9.99 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.props?.currency).toBe("USD");
    expect(
      validateEvent({ ...baseEvent(), props: { currency: "DOLLAR" } }).ok
    ).toBe(false);
  });

  it("rejects negative price and out-of-range quantity", () => {
    expect(validateEvent({ ...baseEvent(), props: { price: -1 } }).ok).toBe(false);
    expect(validateEvent({ ...baseEvent(), props: { quantity: 0 } }).ok).toBe(false);
    expect(validateEvent({ ...baseEvent(), props: { quantity: 1000 } }).ok).toBe(false);
  });

  it("strips control characters-bearing strings", () => {
    const r = validateEvent({
      ...baseEvent(),
      props: { title: "bad\u0000title" },
    });
    expect(r.ok).toBe(false);
  });

  it("drops empty optional props and omits empty props object", () => {
    const r = validateEvent({ ...baseEvent(), props: { title: "  " } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.props).toBeUndefined();
  });

  it("covers every canonical event type end to end", () => {
    for (const event_type of EVENT_TYPES) {
      const r = validateEvent({
        ...baseEvent({ event_type }),
        props: { product_id: "p1" },
      });
      expect(r.ok).toBe(true);
    }
  });
});

describe("validateBatch", () => {
  it("accepts a valid batch", () => {
    const r = validateBatch({ events: [baseEvent(), baseEvent({ event_id: "evt_0002" })] });
    expect(r.ok).toBe(true);
  });

  it("rejects empty and oversized batches", () => {
    expect(validateBatch({ events: [] }).ok).toBe(false);
    const tooBig = Array.from({ length: LIMITS.MAX_BATCH + 1 }, () => baseEvent());
    expect(validateBatch({ events: tooBig }).ok).toBe(false);
  });

  it("rejects the whole batch if any event is invalid", () => {
    const r = validateBatch({ events: [baseEvent(), { nope: true }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("#1");
  });

  it("rejects non-object bodies and missing events array", () => {
    expect(validateBatch(null).ok).toBe(false);
    expect(validateBatch([]).ok).toBe(false);
    expect(validateBatch({}).ok).toBe(false);
  });
});
