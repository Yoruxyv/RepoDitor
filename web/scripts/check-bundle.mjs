import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const assets = new URL("../dist/assets/", import.meta.url);
const names = (await readdir(assets)).filter((name) => name.endsWith(".js")).sort();
if (names.length === 0) throw new Error("No JavaScript bundles found. Run npm run build first.");

// Report sizes until a measured Web release budget exists.
for (const name of names) {
  const content = await readFile(new URL(name, assets));
  console.log(
    `${name}: ${(content.length / 1024).toFixed(2)} KiB raw, ${(gzipSync(content).length / 1024).toFixed(2)} KiB gzip`,
  );
}
