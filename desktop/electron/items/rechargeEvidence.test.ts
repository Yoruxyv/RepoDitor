// @vitest-environment node

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { RechargeEvidenceStore } = require("../../dist-electron/items/rechargeEvidence.cjs");

function evidence(
  capabilities: Array<{ itemName: string; capability: string }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    version: 1,
    installationRoot: "C:/Steam/steamapps/common/REPO",
    manifestPath: "C:/Steam/steamapps/appmanifest_3241660.acf",
    buildId: "23363152",
    resources: {
      path: "C:/Steam/steamapps/common/REPO/REPO_Data/resources.assets",
      size: "100",
      mtimeNs: "200",
      device: "1",
      inode: "2",
    },
    globalManagers: {
      path: "C:/Steam/steamapps/common/REPO/REPO_Data/globalgamemanagers.assets",
      size: "300",
      mtimeNs: "400",
      device: "1",
      inode: "3",
    },
    capabilities,
    ...overrides,
  };
}

describe("RechargeEvidenceStore", () => {
  it("keeps authoritative evidence private and returns only the exact requested subset", () => {
    const store = new RechargeEvidenceStore();
    expect(
      store.remember(
        evidence([
          { itemName: "Item Gun Tranq", capability: "rechargeable" },
          { itemName: "Item Hammer", capability: "not_rechargeable" },
        ]),
      ),
    ).toBe(true);

    expect(store.forRequestedItems(["Item Gun Tranq"])).toMatchObject({
      capabilities: [{ itemName: "Item Gun Tranq", capability: "rechargeable" }],
    });
    expect(store.forRequestedItems(["Item Missing"])).toBeNull();
  });

  it("merges evidence from the same installed source and reuses it repeatedly", () => {
    const store = new RechargeEvidenceStore();
    store.remember(evidence([{ itemName: "Item A", capability: "rechargeable" }]));
    store.remember(evidence([{ itemName: "Item B", capability: "rechargeable" }]));

    const first = store.forRequestedItems(["Item A", "Item B"]);
    const second = store.forRequestedItems(["Item A", "Item B"]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      capabilities: [
        { itemName: "Item A", capability: "rechargeable" },
        { itemName: "Item B", capability: "rechargeable" },
      ],
    });
  });

  it("replaces prior evidence when installed source identity changes", () => {
    const store = new RechargeEvidenceStore();
    store.remember(evidence([{ itemName: "Item A", capability: "rechargeable" }]));
    store.remember(
      evidence([{ itemName: "Item B", capability: "rechargeable" }], {
        installationRoot: "D:/Steam/steamapps/common/REPO",
      }),
    );

    expect(store.forRequestedItems(["Item A"])).toBeNull();
    expect(store.forRequestedItems(["Item B"])).not.toBeNull();
  });

  it("clears cached evidence when a new authoritative payload is malformed", () => {
    const store = new RechargeEvidenceStore();
    store.remember(evidence([{ itemName: "Item A", capability: "rechargeable" }]));

    expect(store.remember({ version: 1 })).toBe(false);
    expect(store.forRequestedItems(["Item A"])).toBeNull();
  });
});
