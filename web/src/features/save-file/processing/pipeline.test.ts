import { isLosslessNumber, LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";

import { decryptEs3, encryptEs3 } from "@/features/save-file/processing/es3";
import {
  classifySave,
  loadSaveBytes,
  loadSaveFile,
  MAX_SAVE_FILE_BYTES,
  reencryptSave,
  SavePipelineError,
} from "@/features/save-file/processing/pipeline";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/processing/serialization";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FIXED_IV = Uint8Array.from({ length: 16 }, (_, index) => index);

const RUN_SAVE = {
  playerNames: { __type: "Dictionary", value: { "111": "Alpha" } },
  dictionaryOfDictionaries: {
    __type: "Dictionary",
    value: { runStats: { currency: 12 } },
  },
};

const META_SAVE = {
  cosmeticHistory: { __type: "List", value: [27, 999] },
  cosmeticUnlocks: { __type: "List", value: [27, 999] },
  cosmeticPresets: { __type: "List", value: [[]] },
};

async function encrypted(source: string): Promise<Uint8Array> {
  return encryptEs3(encoder.encode(source), { testIv: FIXED_IV });
}

describe("local save pipeline", () => {
  it("classifies sanitized Run and MetaSave structures", async () => {
    const run = await loadSaveBytes(await encrypted(JSON.stringify(RUN_SAVE)), "REPO_SAVE.es3");
    const meta = await loadSaveBytes(await encrypted(JSON.stringify(META_SAVE)), "MetaSave.es3");

    expect(run.kind).toBe("run");
    expect(meta.kind).toBe("meta");
    expect(classifySave(parseSaveJson("{}"))).toBe("unsupported");
    expect(classifySave(parseSaveJson(JSON.stringify({ ...RUN_SAVE, ...META_SAVE })))).toBe(
      "unsupported",
    );
  });

  it("preserves unknown fields and unsafe numbers through re-encryption", async () => {
    const source = JSON.stringify(RUN_SAVE).replace(
      /\}\s*$/u,
      ',"unknown":{"large":90071992547409931234567890,"decimal":2.370}}',
    );
    const loaded = await loadSaveBytes(await encrypted(source), "REPO_SAVE.es3");
    const large = (loaded.data.unknown as Record<string, unknown>).large;

    expect(isLosslessNumber(large) && large.value).toBe("90071992547409931234567890");

    const roundTripped = decoder.decode(await decryptEs3(await reencryptSave(loaded)));
    expect(roundTripped).toContain("90071992547409931234567890");
    expect(roundTripped).toContain("2.370");
    expect(parseSaveJson(roundTripped)).toEqual(parseSaveJson(source));
  });

  it("reads only local .es3 bytes", async () => {
    const bytes = await encrypted(JSON.stringify(RUN_SAVE));
    const file = {
      name: "REPO_SAVE.es3",
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    };

    await expect(loadSaveFile(file)).resolves.toMatchObject({
      fileName: "REPO_SAVE.es3",
      kind: "run",
    });
    await expect(loadSaveFile({ ...file, name: "REPO_SAVE.json" })).rejects.toMatchObject({
      code: "unsupported-file",
    });
  });

  it("rejects oversized saves before reading and after byte conversion", async () => {
    let read = false;
    await expect(
      loadSaveFile({
        name: "oversized.es3",
        size: MAX_SAVE_FILE_BYTES + 1,
        arrayBuffer: async () => {
          read = true;
          return new ArrayBuffer(0);
        },
      }),
    ).rejects.toMatchObject({
      code: "unsupported-file",
      message: expect.stringMatching(/16 MiB/u),
    });
    expect(read).toBe(false);

    await expect(
      loadSaveBytes(new Uint8Array(MAX_SAVE_FILE_BYTES + 1), "oversized.es3"),
    ).rejects.toMatchObject({ code: "unsupported-file" });
  });

  it("separates malformed, unsupported, and decryption failures", async () => {
    await expect(loadSaveBytes(await encrypted("{broken"), "broken.es3")).rejects.toMatchObject({
      code: "malformed-save",
    });
    await expect(
      loadSaveBytes(await encrypted('{"valid":"unknown"}'), "unknown.es3"),
    ).rejects.toMatchObject({
      code: "unsupported-save",
    });

    const corrupt = await encrypted(JSON.stringify(RUN_SAVE));
    corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;
    await expect(loadSaveBytes(corrupt, "corrupt.es3")).rejects.toMatchObject({
      code: "decrypt-failed",
      name: SavePipelineError.name,
    });
  });

  it("rejects prototype-sensitive keys before they can change object identity", async () => {
    const nested = JSON.stringify(RUN_SAVE).replace(
      /\}\s*$/u,
      ',"unknown":{"__proto__":{"preserveMe":7}}}',
    );
    const root =
      '{"__proto__":{"playerNames":{"value":{}},' +
      '"dictionaryOfDictionaries":{"value":{"runStats":{}}}}}';
    const inherited = Object.create(RUN_SAVE) as Record<string, unknown>;

    expect(() => parseSaveJson(nested)).toThrow(/unsafe.*__proto__/iu);
    expect(() => parseSaveJson(root)).toThrow(/unsafe.*__proto__/iu);
    expect(classifySave(inherited)).toBe("unsupported");
    await expect(loadSaveBytes(await encrypted(nested), "unsafe.es3")).rejects.toMatchObject({
      code: "malformed-save",
      message: expect.stringMatching(/unsafe.*__proto__/iu),
    });
  });

  it("preserves ordinary objects that resemble lossless number internals", async () => {
    const markerObject = { extra: "keep", isLosslessNumber: true, value: "123" };
    const source = JSON.stringify({ ...RUN_SAVE, unknown: markerObject });
    const loaded = await loadSaveBytes(await encrypted(source), "REPO_SAVE.es3");
    const output = decoder.decode(await decryptEs3(await reencryptSave(loaded)));
    const reparsed = JSON.parse(output) as Record<string, unknown>;

    expect(output).not.toContain("[object Object]");
    expect(Object.hasOwn(reparsed, "unknown")).toBe(true);
    expect(reparsed.unknown).toEqual(markerObject);
  });

  it("rejects an unsafe key hidden by a duplicate ancestor before a save can be loaded", async () => {
    const source =
      '{"playerNames":{"value":{}},"dictionaryOfDictionaries":{"value":{"runStats":{}}},' +
      '"unknown":{"__proto__":{"lost":7}},"unknown":{}}';

    expect(() => parseSaveJson(source)).toThrow(/unsafe.*__proto__/iu);
    await expect(loadSaveBytes(await encrypted(source), "unsafe.es3")).rejects.toMatchObject({
      code: "malformed-save",
      message: expect.stringMatching(/unsafe.*__proto__/iu),
    });
  });

  it.each([
    '{"same":7,"same":7}',
    '{"nested":{"same":{},"same":{}}}',
    '{"items":[{"same":true,"same":true}]}',
    '{"same":1,"\\u0073ame":1}',
  ])("rejects every duplicate key in its own object scope: %s", (source) => {
    expect(() => parseSaveJson(source)).toThrow(/duplicate/iu);
  });

  it.each([
    '{"\\u005f_proto__":{}}',
    '{"items":[{"__pro\\u0074o__":null}]}',
    '{"unknown":{"\\u005f_proto__":{"lost":7}},"unknown":{}}',
  ])("rejects decoded prototype-sensitive keys: %s", (source) => {
    expect(() => parseSaveJson(source)).toThrow(/unsafe.*__proto__/iu);
  });

  it("keeps key scopes separate and ignores key-looking text inside string values", () => {
    const plain = {
      same: "__proto__",
      nested: { same: '{"__proto__":{},"same":1,"same":1}' },
      items: [{ same: "a" }, { same: "b" }, "same", "same"],
      'escaped"key\\': "keep",
    };
    const output = serializeSaveJson(parseSaveJson(JSON.stringify(plain)));

    expect(JSON.parse(output)).toEqual(plain);
  });

  it("rejects inherited MetaSave signatures, typed values, and runStats", () => {
    const inheritedMeta = Object.create(META_SAVE) as Record<string, unknown>;
    const inheritedValue = Object.create({ value: {} }) as Record<string, unknown>;
    const inheritedMetaValue = Object.create({ value: [] }) as Record<string, unknown>;
    const inheritedStats = Object.create({ runStats: {} }) as Record<string, unknown>;

    expect(classifySave(inheritedMeta)).toBe("unsupported");
    expect(classifySave({ ...RUN_SAVE, playerNames: inheritedValue })).toBe("unsupported");
    expect(classifySave({ ...META_SAVE, cosmeticHistory: inheritedMetaValue })).toBe("unsupported");
    expect(classifySave({ ...RUN_SAVE, dictionaryOfDictionaries: { value: inheritedStats } })).toBe(
      "unsupported",
    );
  });

  it.each([
    { ...RUN_SAVE, playerNames: { value: 7 } },
    { ...RUN_SAVE, dictionaryOfDictionaries: { value: { runStats: 9 } } },
  ])("rejects each numeric dictionary independently: %j", (data) => {
    expect(classifySave(parseSaveJson(JSON.stringify(data)))).toBe("unsupported");
  });

  it("serializes genuine lossless numbers as valid numeric JSON", () => {
    const output = serializeSaveJson({ value: new LosslessNumber("90071992547409931234567890") });

    expect(output).toContain('"value": 90071992547409931234567890');
    expect(() => parseSaveJson(output)).not.toThrow();
  });

  it("refuses to encrypt serialization output that cannot be reparsed", async () => {
    const loaded = await loadSaveBytes(await encrypted(JSON.stringify(RUN_SAVE)), "REPO_SAVE.es3");
    const invalidNumber = new LosslessNumber("1");
    invalidNumber.value = "[object Object]";
    loaded.data.unknown = invalidNumber;

    await expect(reencryptSave(loaded)).rejects.toMatchObject({
      name: "SaveSerializationError",
    });
  });

  it("rejects numeric wrappers where save dictionaries are required", async () => {
    const malformedRun = {
      playerNames: { value: 7 },
      dictionaryOfDictionaries: { value: { runStats: 9 } },
    };
    const fakeMetaNumber = {
      cosmeticHistory: { value: [{ isLosslessNumber: true, value: "27" }] },
      cosmeticUnlocks: { value: [] },
      cosmeticPresets: { value: [] },
    };

    expect(classifySave(parseSaveJson(JSON.stringify(malformedRun)))).toBe("unsupported");
    expect(classifySave(parseSaveJson(JSON.stringify(fakeMetaNumber)))).toBe("unsupported");
    await expect(
      loadSaveBytes(await encrypted(JSON.stringify(malformedRun)), "malformed.es3"),
    ).rejects.toMatchObject({ code: "unsupported-save" });
  });
});
