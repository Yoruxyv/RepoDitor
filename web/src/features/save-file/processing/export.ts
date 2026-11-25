import { decryptEs3, encryptEs3 } from "@/features/save-file/processing/es3";
import { classifySave } from "@/features/save-file/processing/classification";
import { validatePendingHealthEdits } from "@/features/run-save/model/runSave";
import type { EditSession } from "@/features/save-file/session/session";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/processing/serialization";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class SaveExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveExportError";
  }
}

export interface VerifiedExport {
  readonly blob: Blob;
  readonly fileName: string;
}

function requireOriginalKind(source: string, session: EditSession): void {
  if (classifySave(parseSaveJson(source)) !== session.originalKind) {
    throw new SaveExportError("The verified copy no longer matches the original save type.");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function stripTrailingDotsAndSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "." || value[end - 1] === " ")) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function deriveExportFileName(originalFileName: string): string {
  const leaf = originalFileName.split(/[\\/]/u).at(-1) ?? "";
  const withoutControls = [...leaf]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && (code < 127 || code > 159);
    })
    .join("");
  const cleaned = stripTrailingDotsAndSpaces(withoutControls.replace(/[<>:"|?*]/gu, "_").trim());
  const stem = stripTrailingDotsAndSpaces(cleaned.replace(/\.es3$/iu, "").trim());
  return `${stem || "REPO_SAVE"}.repoditor.es3`;
}

export async function prepareVerifiedExport(session: EditSession): Promise<VerifiedExport> {
  const source = serializeSaveJson(session.working);
  requireOriginalKind(source, session);
  if (session.originalKind === "run") {
    validatePendingHealthEdits(parseSaveJson(session.baselineSource), session.working);
  }

  const plaintext = encoder.encode(source);
  const encrypted = await encryptEs3(plaintext);
  const verifiedPlaintext = await decryptEs3(encrypted);
  if (!equalBytes(plaintext, verifiedPlaintext)) {
    throw new SaveExportError("The encrypted copy could not be verified byte for byte.");
  }

  requireOriginalKind(decoder.decode(verifiedPlaintext), session);
  return {
    blob: new Blob([encrypted], { type: "application/octet-stream" }),
    fileName: deriveExportFileName(session.originalFileName),
  };
}

export function downloadVerifiedExport(output: VerifiedExport): void {
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(output.blob);
  try {
    anchor.download = output.fileName;
    anchor.href = objectUrl;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
