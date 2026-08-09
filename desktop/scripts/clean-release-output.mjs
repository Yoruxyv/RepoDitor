import { rm } from "node:fs/promises";

const releaseDirectory = new URL("../release/", import.meta.url);

try {
  await rm(releaseDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
} catch (error) {
  throw new Error(
    "Unable to clean desktop/release. Close any running packaged RepoDitor window and retry.",
    { cause: error },
  );
}
