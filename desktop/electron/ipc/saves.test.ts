// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { openSave, saveChanges } = require("../../dist-electron/ipc/saves.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const session = {
  id: "REPO_SAVE_2026_08_08_10_20_30",
  displayName: "2026-08-08 10:20:30",
  path: "C:\\fixture\\save.es3",
  lastModified: "2026-08-08T10:20:30+00:00",
  fingerprint: "a".repeat(64),
  level: 5,
  currency: 12,
  playerCount: 2,
  resumeLocation: "Normal",
};

describe("openSave", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects invalid IDs before starting Python", async () => {
    const fake = client({});
    await expect(openSave(fake, "C:\\real-save.es3")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("parses the typed open contract", async () => {
    const fake = client({ ok: true, session });
    await expect(openSave(fake, session.id)).resolves.toEqual({
      ok: true,
      data: {
        id: session.id,
        name: session.displayName,
        path: session.path,
        modifiedAt: session.lastModified,
        fingerprint: session.fingerprint,
        level: session.level,
        currency: session.currency,
        playerCount: session.playerCount,
        resumeLocation: session.resumeLocation,
      },
    });
    expect(fake.run).toHaveBeenCalledWith("saves-open", [session.id]);
  });

  it("normalizes invalid protocol data", async () => {
    await expect(
      openSave(client({ ok: true, session: { ...session, level: "5" } }), session.id),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("rejects a session for a different save ID", async () => {
    await expect(
      openSave(
        client({ ok: true, session: { ...session, id: "REPO_SAVE_2026_08_08_10_20_31" } }),
        session.id,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("passes through stable domain failures", async () => {
    await expect(
      openSave(
        client({
          ok: false,
          error: { code: "save_corrupt", message: "The selected save is corrupted." },
        }),
        session.id,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "save_corrupt", message: "The selected save is corrupted." },
    });
  });

  it("normalizes Python process failures", async () => {
    const fake = client({});
    vi.mocked(fake.run).mockRejectedValue(new PythonClientError("process_timeout", "private"));
    await expect(openSave(fake, session.id)).resolves.toEqual({
      ok: false,
      error: { code: "process_timeout", message: "The Python save service timed out." },
    });
  });
});

describe("saveChanges", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("passes only validated typed changes to Python and parses the receipt", async () => {
    const updated = {
      ...session,
      lastModified: "2026-08-08T10:21:00+00:00",
      fingerprint: "b".repeat(64),
      currency: 20,
    };
    const fake = client({
      ok: true,
      result: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: updated,
        canonical: {
          fingerprint: updated.fingerprint,
          players: [{ id: "222", health: 100 }],
          upgrades: [{ playerId: "222", key: "playerUpgradeStrength", value: 3 }],
          run: {
            stats: [{ key: "currency", value: 20 }],
            resumeLocation: "Shop / Service Station",
          },
          advanced: {
            items: [
              {
                saveKey: "Item Gun Tranq/1",
                storedCharge: null,
                chargeState: "default_full",
                rechargeCapability: "rechargeable",
                canRefillToFull: false,
              },
            ],
            currentChargeEntryCount: 1,
          },
        },
      },
    });
    const changes = [
      { feature: "players", entity: "222", field: "health", after: 100 },
      { feature: "upgrades", entity: "222", field: "playerUpgradeStrength", after: 3 },
      { feature: "run", entity: "run", field: "currency", after: 20 },
      { feature: "run", entity: "run", field: "resumeLocation", after: "Shop / Service Station" },
      {
        feature: "advanced",
        entity: "Item Gun Tranq/1",
        field: "refillToFull",
        after: true,
      },
    ];

    await expect(saveChanges(fake, session.id, session.fingerprint, changes)).resolves.toEqual({
      ok: true,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: {
          id: updated.id,
          name: updated.displayName,
          path: updated.path,
          modifiedAt: updated.lastModified,
          fingerprint: updated.fingerprint,
          level: updated.level,
          currency: updated.currency,
          playerCount: updated.playerCount,
          resumeLocation: updated.resumeLocation,
        },
        canonical: {
          fingerprint: updated.fingerprint,
          players: [{ id: "222", health: 100 }],
          upgrades: [{ playerId: "222", key: "playerUpgradeStrength", value: 3 }],
          run: {
            stats: [{ key: "currency", value: 20 }],
            resumeLocation: "Shop / Service Station",
          },
          advanced: {
            items: [
              {
                saveKey: "Item Gun Tranq/1",
                storedCharge: null,
                chargeState: "default_full",
                rechargeCapability: "rechargeable",
                canRefillToFull: false,
              },
            ],
            currentChargeEntryCount: 1,
          },
        },
      },
    });
    expect(fake.run).toHaveBeenCalledWith("saves-write", [
      session.id,
      session.fingerprint,
      JSON.stringify(changes),
    ]);
  });

  it("keeps a successful write usable when canonical state is incomplete or mismatched", async () => {
    const updated = { ...session, fingerprint: "b".repeat(64), currency: 20 };
    const changes = [
      { feature: "run" as const, entity: "run" as const, field: "currency" as const, after: 20 },
      {
        feature: "advanced" as const,
        entity: "Item Gun Tranq/1",
        field: "refillToFull" as const,
        after: true as const,
      },
    ];

    const result = await saveChanges(
      client({
        ok: true,
        result: {
          backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
          session: updated,
          canonical: {
            fingerprint: updated.fingerprint,
            run: { stats: [{ key: "currency", value: 20 }] },
            advanced: { items: [], currentChargeEntryCount: 0 },
          },
        },
      }),
      session.id,
      session.fingerprint,
      changes,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        session: { fingerprint: updated.fingerprint },
        canonical: {
          fingerprint: updated.fingerprint,
          run: { stats: [{ key: "currency", value: 20 }] },
        },
      },
    });
    if (result.ok) {
      expect(result.data.canonical?.advanced).toBeUndefined();
    }

    const mismatched = await saveChanges(
      client({
        ok: true,
        result: {
          backupPath: "C:\\fixture\\save.es3.bak-20260808-102101",
          session: updated,
          canonical: {
            fingerprint: "c".repeat(64),
            run: { stats: [{ key: "currency", value: 20 }] },
          },
        },
      }),
      session.id,
      session.fingerprint,
      [changes[0]],
    );
    expect(mismatched).toMatchObject({ ok: true });
    if (mismatched.ok) {
      expect(mismatched.data.canonical).toBeUndefined();
    }
  });

  it("rejects malformed or duplicate changes before starting Python", async () => {
    const fake = client({});
    await expect(
      saveChanges(fake, session.id, session.fingerprint, [
        { feature: "players", entity: "222", field: "health", after: -1 },
      ]),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    await expect(
      saveChanges(fake, session.id, session.fingerprint, [
        {
          feature: "advanced",
          entity: "Item Gun Tranq/1",
          field: "refillToFull",
          after: 100,
        },
      ]),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    await expect(
      saveChanges(fake, session.id, session.fingerprint, [
        { feature: "run", entity: "run", field: "currency", after: 20 },
        { feature: "run", entity: "run", field: "currency", after: 30 },
      ]),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("passes through stale-save failures and rejects malformed receipts", async () => {
    await expect(
      saveChanges(
        client({
          ok: false,
          error: { code: "save_stale", message: "Reopen before saving." },
        }),
        session.id,
        session.fingerprint,
        [{ feature: "run", entity: "run", field: "currency", after: 20 }],
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "save_stale", message: "Reopen before saving." },
    });

    await expect(
      saveChanges(
        client({
          ok: false,
          error: { code: "game_running", message: "Close R.E.P.O. before saving." },
        }),
        session.id,
        session.fingerprint,
        [{ feature: "run", entity: "run", field: "currency", after: 20 }],
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "game_running", message: "Close R.E.P.O. before saving." },
    });

    await expect(
      saveChanges(
        client({ ok: true, result: { backupPath: "", session } }),
        session.id,
        session.fingerprint,
        [{ feature: "run", entity: "run", field: "currency", after: 20 }],
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });
});
