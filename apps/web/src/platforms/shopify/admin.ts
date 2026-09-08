export const SHOPIFY_API_VERSION = "2026-07";

export interface GraphQLError {
  message: string;
}

export async function shopifyGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; errors?: GraphQLError[] }> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`shopify graphql ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as { data?: T; errors?: GraphQLError[] };
}

const WEB_PIXEL_QUERY = `{
  webPixel { id settings }
}`;

const WEB_PIXEL_CREATE_MUTATION = `
  mutation webPixelCreate($webPixelInput: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixelInput) {
      webPixel { id settings }
      userErrors { field message }
    }
  }
`;

const WEB_PIXEL_UPDATE_MUTATION = `
  mutation webPixelUpdate($id: ID!, $webPixelInput: WebPixelInput!) {
    webPixelUpdate(id: $id, webPixel: $webPixelInput) {
      webPixel { id settings }
      userErrors { field message }
    }
  }
`;

export interface WebPixelSettings {
  ingestUrl: string;
  storeToken: string;
}

export async function ensureWebPixel(
  shop: string,
  accessToken: string,
  settings: WebPixelSettings
): Promise<{ ok: boolean; detail: string }> {
  const settingsJson = JSON.stringify(settings);

  const existing = await shopifyGraphql<{ webPixel: { id: string } | null }>(
    shop,
    accessToken,
    WEB_PIXEL_QUERY
  );
  if (existing.errors) {
    return { ok: false, detail: `webPixel read failed: ${existing.errors.map((e) => e.message).join("; ")}` };
  }

  if (existing.data?.webPixel?.id) {
    const updated = await shopifyGraphql(shop, accessToken, WEB_PIXEL_UPDATE_MUTATION, {
      id: existing.data.webPixel.id,
      webPixelInput: { settings: settingsJson },
    });
    const errs = updated.data ? undefined : updated.errors;
    if (errs) return { ok: false, detail: `webPixelUpdate failed: ${errs.map((e) => e.message).join("; ")}` };
    return { ok: true, detail: "web pixel settings updated" };
  }

  const created = await shopifyGraphql<{
    webPixelCreate: { userErrors: Array<{ message: string }> };
  }>(shop, accessToken, WEB_PIXEL_CREATE_MUTATION, {
    webPixelInput: { settings: settingsJson },
  });
  const userErrors = created.data?.webPixelCreate.userErrors ?? [];
  if (userErrors.length > 0) {
    return { ok: false, detail: `webPixelCreate userErrors: ${userErrors.map((e) => e.message).join("; ")}` };
  }
  return { ok: true, detail: "web pixel created" };
}
