/* global caches */

// Keep this worker dependency-free and deliberately conservative: only public
// shell assets and GSI map tiles are eligible for Cache Storage.
const CACHE_VERSION = "v1";
const STATIC_CACHE = `karidoki-static-${CACHE_VERSION}`;
const GSI_TILE_CACHE = `karidoki-gsi-tiles-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const GSI_TILE_HOST = "cyberjapandata.gsi.go.jp";
const MAX_GSI_TILE_ENTRIES = 120;

// These responses contain no account or field data. Route HTML below /app,
// /login, and /auth is intentionally never written to Cache Storage.
const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
];

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "code",
  "email",
  "id_token",
  "next",
  "refresh_token",
  "token",
]);

function isSupabaseRequest(url) {
  return (
    url.hostname === "supabase.co" ||
    url.hostname.endsWith(".supabase.co") ||
    url.hostname.endsWith(".supabase.in") ||
    url.pathname.startsWith("/auth/v1/") ||
    url.pathname.startsWith("/rest/v1/") ||
    url.pathname.startsWith("/storage/v1/") ||
    url.pathname.startsWith("/functions/v1/")
  );
}

function hasSensitiveQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function isPrivateRequest(request, url) {
  return (
    isSupabaseRequest(url) ||
    request.headers.has("authorization") ||
    request.headers.has("cookie") ||
    url.pathname === "/login" ||
    url.pathname.startsWith("/login/") ||
    url.pathname === "/app" ||
    url.pathname.startsWith("/app/") ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/auth" ||
    url.pathname.startsWith("/auth/") ||
    hasSensitiveQuery(url)
  );
}

function isGsiTileRequest(request, url) {
  return (
    request.method === "GET" &&
    url.protocol === "https:" &&
    url.hostname === GSI_TILE_HOST &&
    !request.headers.has("authorization") &&
    !request.headers.has("cookie") &&
    !hasSensitiveQuery(url) &&
    /^\/xyz\/[^/]+\/\d+\/\d+\/\d+\.png$/.test(url.pathname)
  );
}

function isStaticAsset(url) {
  return (
    url.origin === globalThis.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === OFFLINE_URL ||
      url.pathname.startsWith("/icons/"))
  );
}

async function precachePublicShell() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    PRECACHE_URLS.map(async (path) => {
      try {
        const response = await globalThis.fetch(path, { cache: "reload" });
        if (response.ok) await cache.put(path, response);
      } catch {
        // An install must still succeed if one public response is unavailable.
      }
    }),
  );
}

async function removeOldCaches() {
  const names = await caches.keys();
  const keep = new Set([STATIC_CACHE, GSI_TILE_CACHE]);
  await Promise.all(
    names
      .filter((name) => name.startsWith("karidoki-") && !keep.has(name))
      .map((name) => caches.delete(name)),
  );
}

async function trimGsiTileCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_GSI_TILE_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

async function updateGsiTile(cache, request) {
  try {
    const response = await globalThis.fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
      await trimGsiTileCache(cache);
    }
    return response;
  } catch {
    return null;
  }
}

async function serveGsiTile(request) {
  const cache = await caches.open(GSI_TILE_CACHE);
  const cached = await cache.match(request);
  const refresh = updateGsiTile(cache, request);

  // Stale-while-revalidate: an existing tile is immediately usable, while a
  // background request refreshes it for the next view.
  if (cached) {
    void refresh;
    return cached;
  }

  const fresh = await refresh;
  return fresh || Response.error();
}

async function serveNavigation(request) {
  try {
    // Navigation responses are not cached: authenticated HTML may contain
    // personal field data even when the URL itself looks public.
    return await globalThis.fetch(request, { cache: "no-store" });
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function serveStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await globalThis.fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

globalThis.addEventListener("install", (event) => {
  // Let an updated worker wait until the user chooses the visible update
  // action. The first install activates normally because no worker controls
  // the page yet.
  event.waitUntil(precachePublicShell());
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    removeOldCaches().then(() => globalThis.clients.claim()),
  );
});

globalThis.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void globalThis.skipWaiting();
  }
});

globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isGsiTileRequest(request, url)) {
    event.respondWith(serveGsiTile(request));
    return;
  }

  if (url.origin !== globalThis.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(serveNavigation(request));
    return;
  }
  if (isPrivateRequest(request, url)) return;
  if (isStaticAsset(url)) {
    event.respondWith(serveStaticAsset(request));
  }
});
