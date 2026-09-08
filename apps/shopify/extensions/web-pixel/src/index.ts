import { initCollector, type Collector, type CollectorStorage, type TrackInput } from "@beacon/collector";
import { register, type Browser } from "@shopify/web-pixels-extension";

const SESSION_KEY = "bs_sess";
const PAGE_NUM_KEY = "bs_pn";
const LANDING_KEY = "bs_land";

register(({ analytics, browser, settings }) => {
  const ingestUrl = String(settings.ingestUrl ?? "");
  const storeToken = String(settings.storeToken ?? "");
  if (!ingestUrl || !storeToken) return;

  const pending: TrackInput[] = [];
  let collector: Collector | null = null;

  const subscribe = (
    name: "page_viewed" | "product_viewed" | "product_added_to_cart" | "checkout_started",
    map: (event: any) => TrackInput
  ) => {
    analytics.subscribe(name, (event) => {
      const input = map(event);
      if (collector) collector.track(input);
      else pending.push(input);
    });
  };

  const href = (event: any): string | null =>
    event?.context?.document?.location?.href ?? null;
  const referrerOf = (event: any): string | null =>
    event?.context?.document?.referrer ?? null;
  const toId = (value: unknown): string | null =>
    typeof value === "string" ? value.replace(/^gid:\/\/shopify\/\w+\//, "") : null;
  const clientIdOf = (event: any): string => String(event?.clientId ?? "");

  subscribe("page_viewed", (event) => ({
    type: "page.viewed",
    clientId: clientIdOf(event),
    path: href(event),
    referrer: referrerOf(event),
  }));

  subscribe("product_viewed", (event) => {
    const variant = event?.data?.productVariant;
    const product = variant?.product;
    return {
      type: "product.viewed",
      clientId: clientIdOf(event),
      productId: toId(product?.id),
      variantId: toId(variant?.id),
      title: product?.title ?? null,
      price: variant?.price?.amount ?? null,
      currency: variant?.price?.currencyCode ?? null,
      path: href(event),
    };
  });

  subscribe("product_added_to_cart", (event) => {
    const line = event?.data?.cartLine;
    const merch = line?.merchandise;
    return {
      type: "cart.added",
      clientId: clientIdOf(event),
      productId: toId(merch?.product?.id),
      variantId: toId(merch?.id),
      title: merch?.product?.title ?? null,
      price: merch?.price?.amount ?? null,
      currency: merch?.price?.currencyCode ?? null,
      quantity: line?.quantity ?? null,
      path: href(event),
    };
  });

  subscribe("checkout_started", (event) => ({
    type: "checkout.started",
    clientId: clientIdOf(event),
    path: href(event),
  }));

  async function readKey(browser: Browser, key: string): Promise<string | null> {
    try {
      const value = await browser.cookie.get(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async function createStorage(browser: Browser): Promise<CollectorStorage> {
    const [session, pageNum, landing] = await Promise.all([
      readKey(browser, SESSION_KEY),
      readKey(browser, PAGE_NUM_KEY),
      readKey(browser, LANDING_KEY),
    ]);
    const memory = new Map<string, string>(
      [
        [SESSION_KEY, session],
        [PAGE_NUM_KEY, pageNum],
        [LANDING_KEY, landing],
      ].filter(([, v]) => v !== null) as Array<[string, string]>
    );

    return {
      get(key) {
        return memory.get(key) ?? null;
      },
      set(key, value, maxAgeSeconds) {
        memory.set(key, value);
        const cookie = `${key}=${value}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
        void browser.cookie
          .set(cookie)
          .catch(() => browser.cookie.set(key, value).catch(() => undefined));
      },
    };
  }

  void (async () => {
    try {
      const storage = await createStorage(browser);
      collector = initCollector({
        endpoint: ingestUrl,
        storeToken,
        storage,
        batchSize: 1,
      });
      for (const input of pending.splice(0)) collector.track(input);
    } catch (e) {
      console.warn("beacon pixel init failed", e);
    }
  })();

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") collector?.flush();
    });
    window.addEventListener("pagehide", () => collector?.flush());
  }
});
