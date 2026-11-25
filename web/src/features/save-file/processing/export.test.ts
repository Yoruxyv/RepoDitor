import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptEs3 } from "@/features/save-file/processing/es3";
import {
  deriveExportFileName,
  downloadVerifiedExport,
  prepareVerifiedExport,
  SaveExportError,
  type VerifiedExport,
} from "@/features/save-file/processing/export";
import {
  classifySave,
  type LoadedSave,
  type SaveKind,
} from "@/features/save-file/processing/pipeline";
import { createEditSession, type EditSession } from "@/features/save-file/session/session";
import {
  parseSaveJson,
  SaveSerializationError,
  serializeSaveJson,
} from "@/features/save-file/processing/serialization";

const RUN_SOURCE =
  '{"playerNames":{"value":{}},"dictionaryOfDictionaries":{"value":{"runStats":{}}},' +
  '"unknown":{"large":90071992547409931234567890,"decimal":2.370,"label":"keep"}}';
const META_SOURCE =
  '{"cosmeticHistory":{"value":[27,999]},"cosmeticUnlocks":{"value":[27,999]},' +
  '"cosmeticPresets":{"value":[[]]},"unknown":{"large":90071992547409931234567890}}';
const AMBIGUOUS_SOURCE =
  `${RUN_SOURCE.slice(0, -1)},"cosmeticHistory":{"value":[27]},` +
  '"cosmeticUnlocks":{"value":[27]},"cosmeticPresets":{"value":[[]]}}';
const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function session(source: string, kind: SaveKind, fileName = "save.es3"): EditSession {
  const save: LoadedSave = { data: parseSaveJson(source), fileName, kind };
  return createEditSession(save);
}

async function bytes(output: VerifiedExport): Promise<Uint8Array> {
  return new Uint8Array(await output.blob.arrayBuffer());
}

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor?: PropertyDescriptor,
) {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    Reflect.deleteProperty(URL, name);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreUrlMethod("createObjectURL", createObjectUrlDescriptor);
  restoreUrlMethod("revokeObjectURL", revokeObjectUrlDescriptor);
});

describe("verified save export", () => {
  it.each([
    [RUN_SOURCE, "run", ["90071992547409931234567890", "2.370", '"label": "keep"']],
    [META_SOURCE, "meta", ["90071992547409931234567890"]],
  ] as const)("verifies a %s candidate byte for byte as %s", async (source, kind, tokens) => {
    const editSession = session(source, kind);
    const expectedPlaintext = new TextEncoder().encode(serializeSaveJson(editSession.working));

    const output = await prepareVerifiedExport(editSession);
    const decrypted = await decryptEs3(await bytes(output));
    const decryptedSource = new TextDecoder().decode(decrypted);

    expect(Array.from(decrypted)).toEqual(Array.from(expectedPlaintext));
    expect(classifySave(parseSaveJson(decryptedSource))).toBe(kind);
    for (const token of tokens) {
      expect(decryptedSource).toContain(token);
    }
  });

  it.each([
    [META_SOURCE, "run"],
    [RUN_SOURCE, "meta"],
    ['{"unknown":true}', "run"],
    [AMBIGUOUS_SOURCE, "run"],
  ] as const)("rejects a candidate that cannot remain %s", async (source, originalKind) => {
    const editSession = session(originalKind === "run" ? RUN_SOURCE : META_SOURCE, originalKind);
    const candidate = parseSaveJson(source);
    for (const key of Object.keys(editSession.working)) {
      Reflect.deleteProperty(editSession.working, key);
    }
    Object.assign(editSession.working, candidate);

    await expect(prepareVerifiedExport(editSession)).rejects.toBeInstanceOf(SaveExportError);
  });

  it("does not encrypt working data that fails safe serialization", async () => {
    const editSession = session(RUN_SOURCE, "run");
    editSession.working.invalid = undefined;
    const encrypt = vi.spyOn(crypto.subtle, "encrypt");

    await expect(prepareVerifiedExport(editSession)).rejects.toBeInstanceOf(SaveSerializationError);
    expect(encrypt).not.toHaveBeenCalled();
  });

  it("does not produce a download when encrypted plaintext verification differs", async () => {
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    vi.spyOn(crypto.subtle, "decrypt").mockResolvedValue(new Uint8Array([0]).buffer);

    await expect(prepareVerifiedExport(session(RUN_SOURCE, "run"))).rejects.toBeInstanceOf(
      SaveExportError,
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("keeps duplicate and prototype-sensitive key restrictions active", () => {
    expect(() => parseSaveJson('{"same":1,"same":1}')).toThrow(/duplicate/iu);
    expect(() => parseSaveJson('{"\\u005f_proto__":{}}')).toThrow(/unsafe.*__proto__/iu);
  });
});

describe("verified download", () => {
  it.each([
    ["REPO_SAVE_123.es3", "REPO_SAVE_123.repoditor.es3"],
    ["MetaSave.es3", "MetaSave.repoditor.es3"],
    ["C:\\saves\\bad\u0000:name?.es3", "bad_name_.repoditor.es3"],
    ["../\u0000.es3", "REPO_SAVE.repoditor.es3"],
  ])("derives a safe output name from %j", (input, expected) => {
    expect(deriveExportFileName(input)).toBe(expected);
  });

  it("creates, clicks, and revokes one ephemeral URL only when explicitly called", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:verified-1")
      .mockReturnValueOnce("blob:verified-2");
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const output = {
      blob: new Blob([new Uint8Array([1])]),
      fileName: "save.repoditor.es3",
    };

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    downloadVerifiedExport(output);
    downloadVerifiedExport(output);

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:verified-1");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:verified-2");
    expect(document.querySelectorAll('a[download="save.repoditor.es3"]')).toHaveLength(0);
  });
});
