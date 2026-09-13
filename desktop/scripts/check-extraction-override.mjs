import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getNsisPluginsPath } from "app-builder-lib/out/toolsets/windows.js";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const maximumBytes = 0xffff_ffffn;
const templateDigest = "E4174388A0F7A1DF0B85A0742AA1EA7A4B2B18F9F29DCCD6EF10A66212F68148";
const pluginDigest = "B393F05E8FF919EF071181050E1873C9A776E1A0AE8329AEFFF7007D0CADF592";

function digest(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

export function validateExtractionTemplate(version, source) {
  if (version !== "26.15.3" || digest(source.replaceAll("\r\n", "\n")) !== templateDigest) {
    throw new Error(
      "electron-builder extraction changed; review the scoped override before packaging.",
    );
  }
}

export function validateExtractionSizes(listing) {
  const sizes = [...listing.matchAll(/^Size = (\d+)\r?$/gm)];
  const total = sizes.reduce((sum, match) => sum + BigInt(match[1]), 0n);
  if (!sizes.length || total <= 0n || total > maximumBytes) {
    throw new Error("Nsis7z callback requires an actual nonempty payload below 4 GiB.");
  }
  return total;
}

export async function verifyExtractionOverride(archive) {
  const builderRoot = path.join(desktopRoot, "node_modules/app-builder-lib");
  const [metadata, source] = await Promise.all([
    readFile(path.join(builderRoot, "package.json"), "utf8"),
    readFile(path.join(builderRoot, "templates/nsis/include/extractAppPackage.nsh"), "utf8"),
  ]);
  validateExtractionTemplate(JSON.parse(metadata).version, source);
  const configuration = JSON.parse(
    await readFile(path.join(desktopRoot, "package.json"), "utf8"),
  ).build;
  const plugins = await getNsisPluginsPath(
    configuration.toolsets?.nsis,
    configuration.nsis.customNsisResources,
  );
  if (digest(await readFile(path.join(plugins, "x86-unicode/nsis7z.dll"))) !== pluginDigest) {
    throw new Error("Nsis7z binary changed; review byte width and callback stack semantics.");
  }
  const shadowPlugin = path.join(desktopRoot, "build/x86-unicode/nsis7z.dll");
  await access(shadowPlugin).then(
    () => {
      throw new Error("A local Nsis7z replacement would bypass the verified callback API.");
    },
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  const listing = execFileSync(await getPath7za(), ["l", "-slt", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  console.log(
    `Verified extraction override: ${validateExtractionSizes(listing)} payload bytes within the native UInt32 ceiling.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyExtractionOverride(process.argv[2]);
}
