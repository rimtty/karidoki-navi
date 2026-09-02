import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDirectory = resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return readFileSync(resolve(rootDirectory, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`PWA検証失敗: ${message}`);
}

function readPngSize(relativePath) {
  const buffer = readFileSync(resolve(rootDirectory, relativePath));
  assert(
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `${relativePath} はPNGではありません`,
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const manifest = read("src/app/manifest.ts");
for (const field of [
  'name: "刈りどきナビ"',
  'start_url: "/"',
  'display: "standalone"',
  'background_color: "#f6f5eb"',
  'theme_color: "#315c2b"',
  'purpose: "maskable"',
]) {
  assert(manifest.includes(field), `manifest.ts に ${field} がありません`);
}

for (const [relativePath, expectedSize] of [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/icon-192-maskable.png", 192],
  ["public/icons/icon-512-maskable.png", 512],
]) {
  const size = readPngSize(relativePath);
  assert(size.width === expectedSize && size.height === expectedSize, `${relativePath} のサイズが ${expectedSize}x${expectedSize} ではありません`);
}

const serviceWorker = read("public/sw.js");
for (const marker of [
  "precachePublicShell",
  "serveNavigation",
  "isPrivateRequest",
  "isSupabaseRequest",
  "isGsiTileRequest",
  "serveGsiTile",
  "MAX_GSI_TILE_ENTRIES = 120",
]) {
  assert(serviceWorker.includes(marker), `sw.js に ${marker} がありません`);
}
assert(serviceWorker.includes('url.pathname.startsWith("/app/")'), "app配下のHTMLを保存しない方針がありません");
assert(serviceWorker.includes('url.pathname.startsWith("/api/")'), "APIレスポンスを保存しない方針がありません");
assert(serviceWorker.includes('url.pathname.startsWith("/auth/")'), "Authレスポンスを保存しない方針がありません");
assert(serviceWorker.includes('request.method !== "GET"'), "更新系リクエストを除外していません");

console.log("PWA manifest, icons, service worker cache policy: OK");
