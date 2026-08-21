/**
 * Measures built renderer assets against configurable advisory size budgets.
 * Missing build output is an error; exceeding a budget is reported without pretending
 * that this early project has a proven hard release threshold.
 */
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const assetsDirectory = path.resolve(scriptDirectory, "../dist/assets");

const rawBudgetKiB = Number(process.env.BUNDLE_RAW_BUDGET_KIB ?? "450");
const gzipBudgetKiB = Number(process.env.BUNDLE_GZIP_BUDGET_KIB ?? "135");

if (
  !Number.isFinite(rawBudgetKiB) ||
  rawBudgetKiB <= 0 ||
  !Number.isFinite(gzipBudgetKiB) ||
  gzipBudgetKiB <= 0
) {
  throw new Error("Bundle budgets must be positive numeric KiB values.");
}

const rawBudgetBytes = rawBudgetKiB * 1024;
const gzipBudgetBytes = gzipBudgetKiB * 1024;

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

try {
  await access(assetsDirectory);
} catch {
  throw new Error(`Build output was not found at ${assetsDirectory}. Run "npm run build" first.`);
}

const assetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js")).sort();

if (assetNames.length === 0) {
  throw new Error(`No JavaScript bundles were found in ${assetsDirectory}.`);
}

const bundles = await Promise.all(
  assetNames.map(async (name) => {
    const content = await readFile(path.join(assetsDirectory, name));
    return {
      name,
      rawBytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength,
    };
  }),
);

const largestRaw = bundles.reduce((largest, bundle) =>
  bundle.rawBytes > largest.rawBytes ? bundle : largest,
);

const largestGzip = bundles.reduce((largest, bundle) =>
  bundle.gzipBytes > largest.gzipBytes ? bundle : largest,
);

console.log(
  `Largest raw JavaScript chunk: ${largestRaw.name} ${formatKiB(largestRaw.rawBytes)} ` +
    `(warning budget ${formatKiB(rawBudgetBytes)})`,
);

console.log(
  `Largest gzip JavaScript chunk: ${largestGzip.name} ${formatKiB(largestGzip.gzipBytes)} ` +
    `(warning budget ${formatKiB(gzipBudgetBytes)})`,
);

const warnings = [];

if (largestRaw.rawBytes > rawBudgetBytes) {
  warnings.push("raw JavaScript chunk budget exceeded");
}

if (largestGzip.gzipBytes > gzipBudgetBytes) {
  warnings.push("gzip JavaScript chunk budget exceeded");
}

if (warnings.length > 0) {
  console.warn(
    `::warning title=Frontend bundle budget::${warnings.join("; ")}. ` +
      "Review bundle growth; this warning does not fail CI.",
  );
} else {
  console.log("Frontend bundle sizes are within the warning budget.");
}
