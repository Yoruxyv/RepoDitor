const EVIDENCE_VERSION = 1;
const MAX_EVIDENCE_ITEMS = 512;
const MAX_ITEM_NAME_CHARS = 1024;
const MAX_PATH_CHARS = 32767;
const MAX_BUILD_ID_CHARS = 64;
const CAPABILITIES = new Set(["rechargeable", "not_rechargeable", "unknown"] as const);

type RechargeCapability = "rechargeable" | "not_rechargeable" | "unknown";

interface SourceIdentity {
  readonly path: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly device: string;
  readonly inode: string;
}

interface ParsedEvidence {
  readonly version: 1;
  readonly installationRoot: string;
  readonly manifestPath: string;
  readonly buildId: string;
  readonly resources: SourceIdentity;
  readonly globalManagers: SourceIdentity;
  readonly capabilities: Map<string, RechargeCapability>;
}

export interface RechargeEvidenceProvider {
  forRequestedItems(itemNames: readonly string[]): unknown | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readString(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes("\0")
    ? value
    : null;
}

function readDecimalString(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function parseSourceIdentity(value: unknown): SourceIdentity | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["path", "size", "mtimeNs", "device", "inode"])
  ) {
    return null;
  }
  const path = readString(value.path, MAX_PATH_CHARS);
  const size = readDecimalString(value.size);
  const mtimeNs = readDecimalString(value.mtimeNs);
  const device = readDecimalString(value.device);
  const inode = readDecimalString(value.inode);
  return path !== null &&
    size !== null &&
    mtimeNs !== null &&
    device !== null &&
    inode !== null
    ? { path, size, mtimeNs, device, inode }
    : null;
}

function parseEvidence(value: unknown): ParsedEvidence | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "installationRoot",
      "manifestPath",
      "buildId",
      "resources",
      "globalManagers",
      "capabilities",
    ]) ||
    value.version !== EVIDENCE_VERSION ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > MAX_EVIDENCE_ITEMS
  ) {
    return null;
  }

  const installationRoot = readString(value.installationRoot, MAX_PATH_CHARS);
  const manifestPath = readString(value.manifestPath, MAX_PATH_CHARS);
  const buildId = readString(value.buildId, MAX_BUILD_ID_CHARS);
  const resources = parseSourceIdentity(value.resources);
  const globalManagers = parseSourceIdentity(value.globalManagers);
  if (
    installationRoot === null ||
    manifestPath === null ||
    buildId === null ||
    resources === null ||
    globalManagers === null
  ) {
    return null;
  }

  const capabilities = new Map<string, RechargeCapability>();
  for (const rawCapability of value.capabilities) {
    if (
      !isRecord(rawCapability) ||
      !hasExactKeys(rawCapability, ["itemName", "capability"])
    ) {
      return null;
    }
    const itemName = readString(rawCapability.itemName, MAX_ITEM_NAME_CHARS);
    const capability = rawCapability.capability;
    if (
      itemName === null ||
      typeof capability !== "string" ||
      !CAPABILITIES.has(capability as RechargeCapability) ||
      capabilities.has(itemName)
    ) {
      return null;
    }
    capabilities.set(itemName, capability as RechargeCapability);
  }

  return {
    version: EVIDENCE_VERSION,
    installationRoot,
    manifestPath,
    buildId,
    resources,
    globalManagers,
    capabilities,
  };
}

function sameSourceIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  return (
    left.path === right.path &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function sameEvidenceSource(left: ParsedEvidence, right: ParsedEvidence): boolean {
  return (
    left.version === right.version &&
    left.installationRoot === right.installationRoot &&
    left.manifestPath === right.manifestPath &&
    left.buildId === right.buildId &&
    sameSourceIdentity(left.resources, right.resources) &&
    sameSourceIdentity(left.globalManagers, right.globalManagers)
  );
}

function sourcePayload(source: SourceIdentity): SourceIdentity {
  return { ...source };
}

export class RechargeEvidenceStore implements RechargeEvidenceProvider {
  private evidence: ParsedEvidence | null = null;

  remember(value: unknown): boolean {
    const parsed = parseEvidence(value);
    if (parsed === null) {
      this.evidence = null;
      return false;
    }

    if (this.evidence !== null && sameEvidenceSource(this.evidence, parsed)) {
      for (const [itemName, capability] of parsed.capabilities) {
        this.evidence.capabilities.set(itemName, capability);
      }
      return true;
    }

    this.evidence = parsed;
    return true;
  }

  clear(): void {
    this.evidence = null;
  }

  forRequestedItems(itemNames: readonly string[]): unknown | null {
    if (
      this.evidence === null ||
      itemNames.length === 0 ||
      itemNames.length > MAX_EVIDENCE_ITEMS ||
      new Set(itemNames).size !== itemNames.length
    ) {
      return null;
    }

    const capabilities: Array<{ itemName: string; capability: RechargeCapability }> = [];
    for (const itemName of itemNames) {
      if (itemName.length === 0 || itemName.length > MAX_ITEM_NAME_CHARS) return null;
      const capability = this.evidence.capabilities.get(itemName);
      if (capability === undefined) return null;
      capabilities.push({ itemName, capability });
    }

    return {
      version: this.evidence.version,
      installationRoot: this.evidence.installationRoot,
      manifestPath: this.evidence.manifestPath,
      buildId: this.evidence.buildId,
      resources: sourcePayload(this.evidence.resources),
      globalManagers: sourcePayload(this.evidence.globalManagers),
      capabilities,
    };
  }
}

export const rechargeEvidenceStore = new RechargeEvidenceStore();
