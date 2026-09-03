import { readFile } from "node:fs/promises";
import { join } from "node:path";

const workerPath = join(
  process.cwd(),
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
);

export const dynamic = "force-static";

export async function GET() {
  const source = await readFile(workerPath, "utf8");
  return new Response(source, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "text/javascript; charset=utf-8",
    },
  });
}
