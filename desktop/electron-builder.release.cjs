const packageJson = require("./package.json");

const REQUIRED_SIGNING_ENV = Object.freeze([
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME",
  "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME",
  "AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
]);

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Official Windows signing requires ${name}.`);
  }
  return value;
}

function createReleaseConfig(environment = process.env) {
  const values = Object.fromEntries(
    REQUIRED_SIGNING_ENV.map((name) => [name, required(environment, name)]),
  );
  let endpoint;
  try {
    endpoint = new URL(values.AZURE_ARTIFACT_SIGNING_ENDPOINT);
  } catch {
    throw new Error("AZURE_ARTIFACT_SIGNING_ENDPOINT must be a valid HTTPS URL.");
  }
  if (
    endpoint.protocol !== "https:"
    || !endpoint.hostname.endsWith(".codesigning.azure.net")
    || endpoint.username
    || endpoint.password
    || endpoint.pathname !== "/"
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error(
      "AZURE_ARTIFACT_SIGNING_ENDPOINT must be an Azure HTTPS code-signing endpoint.",
    );
  }

  return {
    ...packageJson.build,
    forceCodeSigning: true,
    win: {
      ...packageJson.build.win,
      azureSignOptions: {
        publisherName: values.AZURE_ARTIFACT_SIGNING_PUBLISHER_NAME,
        endpoint: endpoint.href.replace(/\/$/, ""),
        certificateProfileName:
          values.AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME,
        codeSigningAccountName: values.AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME,
        fileDigest: "SHA256",
        timestampDigest: "SHA256",
      },
    },
  };
}

function releaseConfig() {
  return createReleaseConfig(process.env);
}

releaseConfig.createReleaseConfig = createReleaseConfig;
releaseConfig.REQUIRED_SIGNING_ENV = REQUIRED_SIGNING_ENV;

module.exports = releaseConfig;
