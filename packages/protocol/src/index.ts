export const EVENT_TYPES = [
  "page.viewed",
  "product.viewed",
  "cart.added",
  "checkout.started",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const LIMITS = {
  MAX_BATCH: 20,
  MAX_BODY_BYTES: 16 * 1024,
  MAX_ID_LENGTH: 64,
  MAX_CLIENT_ID_LENGTH: 128,
  MAX_REF_LENGTH: 256,
  MAX_PATH_LENGTH: 512,
  MAX_TITLE_LENGTH: 256,
  MAX_CURRENCY_LENGTH: 3,
  MAX_PAGE_NUM: 1000,
  MAX_QUANTITY: 999,
  TS_SKEW_SECONDS: 600,
} as const;

export interface BeaconEventProps {
  path?: string;
  referrer?: string;
  product_id?: string;
  variant_id?: string;
  title?: string;
  price?: number;
  currency?: string;
  quantity?: number;
}

export interface BeaconEvent {
  event_id: string;
  event_type: EventType;
  ts: string;
  session_id: string;
  client_id: string;
  page_num: number;
  landing_product_id?: string | null;
  props?: BeaconEventProps;
}

export interface EventBatch {
  events: BeaconEvent[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ID_RE = /^[A-Za-z0-9_.:-]+$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s === "" ? undefined : s;
}

function validateId(
  v: unknown,
  field: string,
  maxLength: number
): ValidationResult<string> {
  const s = asTrimmedString(v);
  if (s === undefined) return { ok: false, error: `${field} is required` };
  if (s.length > maxLength) return { ok: false, error: `${field} too long` };
  if (!ID_RE.test(s)) return { ok: false, error: `${field} has invalid characters` };
  return { ok: true, value: s };
}

function validateIsoTimestamp(v: unknown): ValidationResult<string> {
  const s = asTrimmedString(v);
  if (s === undefined) return { ok: false, error: "ts is required" };
  const t = Date.parse(s);
  if (Number.isNaN(t)) return { ok: false, error: "ts is not a valid ISO 8601 timestamp" };
  const skew = Math.abs(Date.now() - t) / 1000;
  if (skew > LIMITS.TS_SKEW_SECONDS) {
    return { ok: false, error: "ts is outside the allowed clock-skew window" };
  }
  return { ok: true, value: new Date(t).toISOString() };
}

function validateOptionalRef(
  v: unknown,
  field: string,
  maxLength: number
): ValidationResult<string | undefined> {
  const s = asTrimmedString(v);
  if (s === undefined) return { ok: true, value: undefined };
  if (s.length > maxLength) return { ok: false, error: `${field} too long` };
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    return { ok: false, error: `${field} contains control characters` };
  }
  return { ok: true, value: s };
}

export function validateEvent(input: unknown): ValidationResult<BeaconEvent> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "event must be an object" };
  }
  const raw = input as Record<string, unknown>;

  const id = validateId(raw.event_id, "event_id", LIMITS.MAX_ID_LENGTH);
  if (!id.ok) return id;

  const eventType = asTrimmedString(raw.event_type);
  if (!eventType || !(EVENT_TYPES as readonly string[]).includes(eventType)) {
    return { ok: false, error: `event_type must be one of: ${EVENT_TYPES.join(", ")}` };
  }

  const ts = validateIsoTimestamp(raw.ts);
  if (!ts.ok) return ts;

  const sessionId = validateId(raw.session_id, "session_id", LIMITS.MAX_ID_LENGTH);
  if (!sessionId.ok) return sessionId;

  const clientId = validateId(
    raw.client_id,
    "client_id",
    LIMITS.MAX_CLIENT_ID_LENGTH
  );
  if (!clientId.ok) return clientId;

  const pageNum = raw.page_num;
  if (
    typeof pageNum !== "number" ||
    !Number.isInteger(pageNum) ||
    pageNum < 1 ||
    pageNum > LIMITS.MAX_PAGE_NUM
  ) {
    return { ok: false, error: "page_num must be an integer between 1 and 1000" };
  }

  const landingProductId = validateOptionalRef(
    raw.landing_product_id,
    "landing_product_id",
    LIMITS.MAX_REF_LENGTH
  );
  if (!landingProductId.ok) return landingProductId;

  const propsRaw = raw.props;
  if (propsRaw !== undefined && (typeof propsRaw !== "object" || propsRaw === null || Array.isArray(propsRaw))) {
    return { ok: false, error: "props must be an object" };
  }
  const p = (propsRaw ?? {}) as Record<string, unknown>;

  const path = validateOptionalRef(p.path, "props.path", LIMITS.MAX_PATH_LENGTH);
  if (!path.ok) return path;
  const referrer = validateOptionalRef(p.referrer, "props.referrer", LIMITS.MAX_REF_LENGTH);
  if (!referrer.ok) return referrer;
  const productId = validateOptionalRef(p.product_id, "props.product_id", LIMITS.MAX_REF_LENGTH);
  if (!productId.ok) return productId;
  const variantId = validateOptionalRef(p.variant_id, "props.variant_id", LIMITS.MAX_REF_LENGTH);
  if (!variantId.ok) return variantId;
  const title = validateOptionalRef(p.title, "props.title", LIMITS.MAX_TITLE_LENGTH);
  if (!title.ok) return title;

  let price: number | undefined;
  if (p.price !== undefined && p.price !== null) {
    if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0) {
      return { ok: false, error: "props.price must be a non-negative number" };
    }
    price = Math.round(p.price * 1e6) / 1e6;
  }

  let currency: string | undefined;
  if (p.currency !== undefined && p.currency !== null) {
    const c = asTrimmedString(p.currency);
    if (c === undefined || !CURRENCY_RE.test(c)) {
      return { ok: false, error: "props.currency must be a 3-letter code" };
    }
    currency = c.toUpperCase();
  }

  let quantity: number | undefined;
  if (p.quantity !== undefined && p.quantity !== null) {
    if (typeof p.quantity !== "number" || !Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > LIMITS.MAX_QUANTITY) {
      return { ok: false, error: "props.quantity must be an integer between 1 and 999" };
    }
    quantity = p.quantity;
  }

  if (
    (eventType === "product.viewed" || eventType === "cart.added") &&
    productId.value === undefined
  ) {
    return { ok: false, error: `${eventType} requires props.product_id` };
  }

  const props: BeaconEventProps = {};
  if (path.value !== undefined) props.path = path.value;
  if (referrer.value !== undefined) props.referrer = referrer.value;
  if (productId.value !== undefined) props.product_id = productId.value;
  if (variantId.value !== undefined) props.variant_id = variantId.value;
  if (title.value !== undefined) props.title = title.value;
  if (price !== undefined) props.price = price;
  if (currency !== undefined) props.currency = currency;
  if (quantity !== undefined) props.quantity = quantity;

  const event: BeaconEvent = {
    event_id: id.value,
    event_type: eventType as EventType,
    ts: ts.value,
    session_id: sessionId.value,
    client_id: clientId.value,
    page_num: pageNum,
    ...(landingProductId.value !== undefined ? { landing_product_id: landingProductId.value } : {}),
    ...(Object.keys(props).length > 0 ? { props } : {}),
  };

  return { ok: true, value: event };
}

export function validateBatch(input: unknown): ValidationResult<BeaconEvent[]> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const events = (input as Record<string, unknown>).events;
  if (!Array.isArray(events)) {
    return { ok: false, error: "events must be an array" };
  }
  if (events.length === 0) {
    return { ok: false, error: "events must not be empty" };
  }
  if (events.length > LIMITS.MAX_BATCH) {
    return { ok: false, error: `events must not exceed ${LIMITS.MAX_BATCH} items` };
  }
  const valid: BeaconEvent[] = [];
  const rejected: { index: number; error: string }[] = [];
  events.forEach((e, index) => {
    const result = validateEvent(e);
    if (result.ok) valid.push(result.value);
    else rejected.push({ index, error: result.error });
  });
  if (rejected.length > 0) {
    return {
      ok: false,
      error: `all events must be valid; rejected ${rejected.length}: ${rejected
        .slice(0, 3)
        .map((r) => `#${r.index} ${r.error}`)
        .join("; ")}`,
    };
  }
  return { ok: true, value: valid };
}
