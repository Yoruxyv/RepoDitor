import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const releaseConfig = require("../electron-builder.release.cjs");
const { validateConfiguration } = require("app-builder-lib/out/util/config/config");
const { DebugLogger } = require("builder-util/out/DebugLogger");

const environment = {
  AZURE_ARTIFACT_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
  AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME: "repoditor-signing",
  AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME: "public-release",
  AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME: "RepoDitor Publisher",
  AZURE_TENANT_ID: "test-tenant-id",
  AZURE_CLIENT_ID: "test-client-id",
  AZURE_CLIENT_SECRET: "test-only-secret-must-not-be-serialized",
};

test("official release signing fails closed when configuration is missing", () => {
  assert.throws(() => releaseConfig.createReleaseConfig({}), /AZURE_ARTIFACT_SIGNING_ENDPOINT/);
  assert.throws(
    () => releaseConfig.createReleaseConfig({ ...environment, AZURE_CLIENT_SECRET: "" }),
    /AZURE_CLIENT_SECRET/,
  );
});

test("official release signing preserves packaging and enables Azure signing", () => {
  const config = releaseConfig.createReleaseConfig(environment);

  assert.equal(config.forceCodeSigning, true);
  assert.deepEqual(config.files, packageJson.build.files);
  assert.deepEqual(config.extraResources, packageJson.build.extraResources);
  assert.deepEqual(config.nsis, packageJson.build.nsis);
  assert.deepEqual(config.win.azureSignOptions, {
    publisherName: "RepoDitor Publisher",
    endpoint: "https://eus.codesigning.azure.net",
    certificateProfileName: "public-release",
    codeSigningAccountName: "repoditor-signing",
    fileDigest: "SHA256",
    timestampDigest: "SHA256",
  });
  assert.doesNotMatch(JSON.stringify(config), /test-only-secret-must-not-be-serialized/);
  assert.doesNotMatch(JSON.stringify(config), /test-tenant-id|test-client-id/);
});

test("official release signing matches the installed electron-builder schema", async () => {
  await validateConfiguration(
    releaseConfig.createReleaseConfig(environment),
    new DebugLogger(false),
  );
});

test("official release signing accepts only Azure HTTPS signing endpoints", () => {
  for (const endpoint of [
    "http://eus.codesigning.azure.net",
    "https://example.com",
    "https://eus.codesigning.azure.net/not-the-account-endpoint",
    "not-a-url",
  ]) {
    assert.throws(
      () =>
        releaseConfig.createReleaseConfig({
          ...environment,
          AZURE_ARTIFACT_SIGNING_ENDPOINT: endpoint,
        }),
      /AZURE_ARTIFACT_SIGNING_ENDPOINT/,
    );
  }
});
