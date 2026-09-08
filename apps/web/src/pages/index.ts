import type { APIRoute } from "astro";

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const target = new URL("/shopify/app", url.origin);
  target.search = url.search;
  return ctx.redirect(target.toString(), 302);
};
