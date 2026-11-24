import { createHash } from "node:crypto";

import cosmetics from "../src/features/cosmetics/known-cosmetics.v1.json" with { type: "json" };
import recharge from "../src/features/recharge/recharge-capabilities.v1.json" with { type: "json" };

export const capabilitySignature = `sha256:${createHash("sha256")
  .update(JSON.stringify([recharge, cosmetics]))
  .digest("hex")}`;
