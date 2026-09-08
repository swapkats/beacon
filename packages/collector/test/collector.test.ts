import { describe, expect, it } from "vitest";
import { initCollector, type CollectorStorage, type TrackInput } from "../src/index.js";

class FakeStorage implements CollectorStorage {
  store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
}

interface SentBatch {
  token: string;
  events: Array<Record<string, unknown>>;
}

function setup(opts: { uuid?: string[] } = {}) {
  const storage = new FakeStorage();
  const sent: SentBatch[] = [];
  let uuidCounter = 0;
  const uuids = opts.uuid ?? [];
  const collector = initCollector({
    endpoint: "https://ingest.example/v1/events",
    storeToken: "tok_test",
    storage,
    transport: {
      send(payload: string) {
        sent.push(JSON.parse(payload));
        return true;
      },
    },
    flushIntervalMs: 60_000,
    now: () => 1_700_000_000_000,
    uuid: () => uuids[uuidCounter++] ?? `id_${uuidCounter}`,
  });
  return { collector, sent, storage };
}

const input = (over: Partial<TrackInput> = {}): TrackInput => ({
  type: "page.viewed",
  clientId: "client_1",
  ...over,
});

describe("collector", () => {
  it("emits a canonical batch with envelope fields", () => {
    const { collector, sent } = setup();
    collector.track(input());
    collector.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("tok_test");
    const ev = sent[0].events[0];
    expect(ev.event_type).toBe("page.viewed");
    expect(ev.session_id).toBe("id_1");
    expect(ev.event_id).toBe("id_2");
    expect(ev.page_num).toBe(1);
    expect(ev.landing_product_id).toBeNull();
  });

  it("keeps one session and one page number across events of the same page instance", () => {
    const { collector, sent } = setup();
    collector.track(input({ type: "product.viewed", clientId: "c", productId: "p1" }));
    collector.track(input());
    collector.flush();
    const events = sent[0].events;
    expect(events).toHaveLength(2);
    expect(events[0].session_id).toBe(events[1].session_id);
    expect(events[0].page_num).toBe(1);
    expect(events[1].page_num).toBe(1);
  });

  it("continues the session and advances page numbers on the next page instance", () => {
    const first = setup({ uuid: ["sess_a"] });
    first.collector.track(input());
    first.collector.track(input({ type: "product.viewed", productId: "p1" }));

    const second = setup({ uuid: ["sess_a"] });
    second.storage.store.clear();
    for (const [k, v] of first.storage.store) second.storage.store.set(k, v);
    second.collector.track(input());
    second.collector.flush();

    const ev = second.sent[0].events[0];
    expect(ev.session_id).toBe("sess_a");
    expect(ev.page_num).toBe(2);
  });

  it("records the landing product only when the session starts on a product page", () => {
    const productLanding = setup({ uuid: ["s1"] });
    productLanding.collector.track(input({ type: "product.viewed", productId: "p1" }));
    productLanding.collector.track(input());
    productLanding.collector.flush();
    const events = productLanding.sent[0].events;
    expect(events[0].landing_product_id).toBe("p1");
    expect(events[1].landing_product_id).toBe("p1");

    const homeLanding = setup({ uuid: ["s2"] });
    homeLanding.collector.track(input());
    homeLanding.collector.track(input({ type: "product.viewed", productId: "p2" }));
    homeLanding.collector.flush();
    const later = homeLanding.sent[0].events[1];
    expect(later.landing_product_id).toBeNull();
  });

  it("auto-flushes when the batch size is reached", () => {
    const { collector, sent } = setup();
    for (let i = 0; i < 20; i++) collector.track(input({ clientId: `c${i}` }));
    expect(sent).toHaveLength(1);
    expect(sent[0].events).toHaveLength(20);
  });

  it("maps track input props onto the canonical props object", () => {
    const { collector, sent } = setup();
    collector.track(
      input({
        type: "cart.added",
        productId: "p1",
        variantId: "v2",
        title: "Tee",
        price: 19.99,
        currency: "eur",
        quantity: 2,
        path: "/products/p1",
      })
    );
    collector.flush();
    const ev = sent[0].events[0];
    expect(ev.event_type).toBe("cart.added");
    expect(ev.props).toMatchObject({
      product_id: "p1",
      variant_id: "v2",
      title: "Tee",
      price: 19.99,
      currency: "eur",
      quantity: 2,
      path: "/products/p1",
    });
  });

  it("drops events without clientId and keeps the queue usable", () => {
    const { collector, sent } = setup();
    collector.track(input({ clientId: "" }));
    collector.track(input());
    collector.flush();
    expect(sent[0].events).toHaveLength(1);
  });
});
