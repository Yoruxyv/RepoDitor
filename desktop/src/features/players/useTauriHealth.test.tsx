import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  tauriHealthApi,
  type HealthCanonical,
  type HealthState,
  type HealthTransaction,
} from "@/app/tauriHealthApi";
import { players, session, upgrades } from "@/test/repoditorApiFixture";
import { useTauriHealth } from "./useTauriHealth";

function canonical(health = 80, fingerprint = session.fingerprint): HealthCanonical {
  return {
    opened: {
      session: { ...session, fingerprint },
      requiredUpgradeVisualKeys: [],
      presentationReadiness: "ready",
    },
    players: players.map((player) => (player.id === "111" ? { ...player, health } : player)),
    upgrades,
  };
}
function idle(projection = canonical()): HealthState {
  return {
    enabled: true,
    state: "idle",
    pending: null,
    canonical: projection,
    upgradeSession: "synthetic-session",
  };
}
function transaction(
  operationId: string,
  status: HealthTransaction["status"],
  projection: HealthCanonical | null = null,
): HealthTransaction {
  return {
    operationId,
    status,
    fingerprint: projection?.opened.session.fingerprint ?? null,
    backupAvailable: status === "applied",
    reason: null,
    canonical: projection,
  };
}
function setup() {
  const api = {
    writeUpgrades: vi
      .fn<typeof tauriHealthApi.writeUpgrades>()
      .mockImplementation(async (request) => transaction(request.operationId, "applied")),
    state: vi.fn<typeof tauriHealthApi.state>().mockResolvedValue(idle()),
    write: vi
      .fn<typeof tauriHealthApi.write>()
      .mockImplementation(async (request) => transaction(request.operationId, "applied")),
    recover: vi
      .fn<typeof tauriHealthApi.recover>()
      .mockImplementation(async (_save, id) =>
        transaction(id, "applied", canonical(17, "b".repeat(64))),
      ),
  };
  const accept = vi.fn();
  const hook = renderHook(() => useTauriHealth(session, players, accept, api));
  return { ...hook, api, accept };
}
async function ready(subject: ReturnType<typeof setup>) {
  await waitFor(() => expect(subject.result.current.phase).toBe("editing"));
}
function stage(subject: ReturnType<typeof setup>, health = 17) {
  act(() => subject.result.current.edit(players[0]!, health));
}

describe("synthetic health ownership", () => {
  function projectedUpgrade(value: number): HealthCanonical {
    return {
      ...canonical(80, "b".repeat(64)),
      upgrades: upgrades.map((upgrade) => ({
        ...upgrade,
        values: upgrade.values.map((entry) =>
          upgrade.key === "playerUpgradeStrength" && entry.playerId === "111"
            ? { ...entry, value }
            : entry,
        ),
      })),
    };
  }
  it("keeps upgrade drafts locked after response loss and clears them only after canonical acknowledgement", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.writeUpgrades.mockImplementation(async (request) =>
      transaction(request.operationId, "uncertain"),
    );
    subject.api.recover.mockImplementation(async (_save, operation) =>
      transaction(operation, "applied", projectedUpgrade(3)),
    );
    const strength = upgrades.find((upgrade) => upgrade.key === "playerUpgradeStrength")!;
    act(() => subject.result.current.editUpgrade(strength, players[0]!, 3));
    await act(() => subject.result.current.save());
    expect(subject.result.current.phase).toBe("recovery");
    expect(subject.result.current.locked).toBe(true);
    act(() => subject.result.current.revertUpgrade("111", strength.key));
    expect(subject.result.current.upgradeEdits).toHaveLength(1);
    await act(() => subject.result.current.recover());
    expect(subject.result.current.phase).toBe("saved");
    expect(subject.result.current.upgradeEdits).toHaveLength(0);
    expect(subject.api.recover).toHaveBeenLastCalledWith(session.id, expect.any(String), true);
    expect(subject.api.write).not.toHaveBeenCalled();
  });
  it("does not acknowledge or clear a purported applied upgrade whose canonical value differs", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.recover.mockImplementation(async (_save, operation) =>
      transaction(operation, "applied", projectedUpgrade(4)),
    );
    act(() =>
      subject.result.current.editUpgrade(
        upgrades.find((u) => u.key === "playerUpgradeStrength")!,
        players[0]!,
        3,
      ),
    );
    await act(() => subject.result.current.save());
    expect(subject.result.current.phase).toBe("conflict");
    expect(subject.result.current.upgradeEdits[0]?.after).toBe(3);
    expect(subject.api.recover).toHaveBeenCalledTimes(1);
    expect(subject.api.recover).toHaveBeenCalledWith(session.id, expect.any(String), false);
  });
  it("blocks mixed Save and retains the other group when health alone is reverted", async () => {
    const subject = setup();
    await ready(subject);
    stage(subject);
    act(() =>
      subject.result.current.editUpgrade(
        upgrades.find((u) => u.key === "playerUpgradeStrength")!,
        players[0]!,
        3,
      ),
    );
    await act(() => subject.result.current.save());
    expect(subject.api.write).not.toHaveBeenCalled();
    expect(subject.api.writeUpgrades).not.toHaveBeenCalled();
    act(() => subject.result.current.revertHealth());
    expect(subject.result.current.pending).toBeNull();
    expect(subject.result.current.upgradeEdits).toHaveLength(1);
  });
  it("restores a durable batch after remount and retains unchanged drafts until explicit Revert", async () => {
    const subject = setup();
    await ready(subject);
    const op = "c".repeat(32);
    subject.api.state.mockResolvedValue({
      enabled: true,
      state: "pending",
      canonical: null,
      pending: {
        operationId: op,
        fingerprint: session.fingerprint,
        intent: {
          upgrades: [{ playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 }],
        },
      },
      upgradeSession: "synthetic-session",
    });
    await act(() => subject.result.current.refresh());
    await waitFor(() => expect(subject.result.current.phase).toBe("recovery"));
    expect(subject.result.current.upgradeEdits[0]?.after).toBe(3);
    subject.api.recover.mockImplementation(async (_save, operation) =>
      transaction(operation, "unchanged", canonical()),
    );
    await act(() => subject.result.current.recover());
    expect(subject.result.current.phase).toBe("unchanged");
    expect(subject.result.current.upgradeEdits).toHaveLength(1);
    await act(() => subject.result.current.revert());
    expect(subject.result.current.upgradeEdits).toHaveLength(0);
    expect(subject.api.recover).toHaveBeenLastCalledWith(session.id, op, true);
  });
  it("keeps a read-only busy poll after an explicit refresh without replaying changes", async () => {
    const subject = setup();
    await ready(subject);
    vi.useFakeTimers();
    try {
      subject.api.state
        .mockResolvedValueOnce({ enabled: true, state: "busy", pending: null, canonical: null })
        .mockResolvedValueOnce({
          enabled: true,
          state: "pending",
          canonical: null,
          pending: {
            operationId: "f".repeat(32),
            fingerprint: session.fingerprint,
            intent: { playerId: "111", health: 17, before: 80 },
          },
        });
      await act(() => subject.result.current.refresh());
      expect(subject.result.current.phase).toBe("checking");
      expect(subject.result.current.locked).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(subject.result.current.phase).toBe("recovery");
      expect(subject.api.write).not.toHaveBeenCalled();
      expect(subject.api.recover).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("never clears a different draft while reconciling another operation on the save", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.write.mockImplementation(async (request) => ({
      ...transaction(request.operationId, "rejected"),
      reason: "write_recovery_required",
    }));
    const other = "f".repeat(32);
    subject.api.state.mockResolvedValue({
      enabled: true,
      state: "pending",
      canonical: null,
      pending: {
        operationId: other,
        fingerprint: session.fingerprint,
        intent: { playerId: "222", before: 0, health: 40 },
      },
    });
    stage(subject);
    await act(() => subject.result.current.save());
    const otherCanonical = canonical(80, "d".repeat(64));
    otherCanonical.players[1] = { ...players[1]!, health: 40 };
    subject.api.recover.mockImplementation(async (_save, id) =>
      transaction(id, "applied", otherCanonical),
    );
    expect(subject.result.current.operationId).toBe(other);
    await act(() => subject.result.current.recover());
    expect(subject.result.current.pending).toMatchObject({ entity: "111", after: 17 });
    expect(subject.result.current.phase).toBe("unchanged");
    expect(subject.result.current.operationId).toBeNull();
    expect(subject.result.current.backupVerified).toBe(false);
    expect(subject.api.write).toHaveBeenCalledOnce();
  });
  it("edits and reverts without a write or recovery request", async () => {
    const subject = setup();
    await ready(subject);
    stage(subject);
    expect(subject.result.current.pending).toMatchObject({ entity: "111", before: 80, after: 17 });
    await act(() => subject.result.current.revert());
    expect(subject.result.current.pending).toBeNull();
    expect(subject.api.write).not.toHaveBeenCalled();
    expect(subject.api.recover).not.toHaveBeenCalled();
  });

  it("admits a single click, verifies canonical values and acknowledges only afterwards", async () => {
    const subject = setup();
    await ready(subject);
    stage(subject);
    await act(async () => {
      const first = subject.result.current.save();
      await subject.result.current.save();
      await first;
    });
    expect(subject.api.write).toHaveBeenCalledOnce();
    const request = subject.api.write.mock.calls[0]![0];
    expect(request).toMatchObject({
      saveId: session.id,
      fingerprint: session.fingerprint,
      playerId: "111",
      health: 17,
    });
    expect(request.operationId).toMatch(/^[0-9a-f]{32}$/);
    expect(subject.api.recover.mock.calls.map((call) => call[2])).toEqual([false, true]);
    expect(subject.accept).toHaveBeenLastCalledWith(canonical(17, "b".repeat(64)));
    expect(subject.result.current.phase).toBe("saved");
    expect(subject.result.current.pending).toBeNull();
    expect(subject.result.current.backupVerified).toBe(true);
  });

  it("retains uncertain intent and never replays it while locked", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.write.mockImplementation(async (request) => ({
      ...transaction(request.operationId, "uncertain"),
      backupAvailable: true,
    }));
    stage(subject);
    await act(() => subject.result.current.save());
    expect(subject.result.current.phase).toBe("recovery");
    expect(subject.result.current.backupVerified).toBe(false);
    await act(() => subject.result.current.save());
    await act(() => subject.result.current.revert());
    expect(subject.result.current.pending?.after).toBe(17);
    expect(subject.api.write).toHaveBeenCalledOnce();
    expect(subject.api.recover).not.toHaveBeenCalled();
    await act(() => subject.result.current.recover());
    expect(subject.result.current.phase).toBe("saved");
    expect(subject.api.write).toHaveBeenCalledOnce();
  });

  it("keeps rejected intent and refreshes the base only on an explicit read action", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.write.mockImplementation(async (request) => ({
      ...transaction(request.operationId, "rejected"),
      reason: "save_stale",
    }));
    stage(subject);
    await act(() => subject.result.current.save());
    expect(subject.result.current.phase).toBe("rejected");
    expect(subject.result.current.pending?.after).toBe(17);
    expect(subject.api.recover).not.toHaveBeenCalled();
    subject.api.state.mockResolvedValue(idle(canonical(90, "c".repeat(64))));
    await act(() => subject.result.current.refresh());
    expect(subject.result.current.pending).toMatchObject({ before: 90, after: 17 });
    expect(subject.api.write).toHaveBeenCalledOnce();
    await act(() => subject.result.current.save());
    expect(subject.api.write.mock.calls[1]![0].fingerprint).toBe("c".repeat(64));
  });

  it("holds an unchanged operation until a new explicit Save and uses a fresh identity", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.write.mockImplementation(async (request) =>
      transaction(request.operationId, "uncertain"),
    );
    subject.api.recover.mockImplementation(async (_save, id) =>
      transaction(id, "unchanged", canonical()),
    );
    stage(subject);
    await act(() => subject.result.current.save());
    const first = subject.api.write.mock.calls[0]![0].operationId;
    await act(() => subject.result.current.recover());
    expect(subject.result.current.phase).toBe("unchanged");
    expect(subject.result.current.pending?.after).toBe(17);
    expect(subject.api.recover.mock.calls.map((call) => call[2])).toEqual([false]);
    expect(subject.api.write).toHaveBeenCalledOnce();
    await act(() => subject.result.current.save());
    expect(subject.api.recover.mock.calls[1]![2]).toBe(true);
    expect(subject.api.write).toHaveBeenCalledTimes(2);
    expect(subject.api.write.mock.calls[1]![0].operationId).not.toBe(first);
  });

  it("rediscovers durable identity after remount and ignores the old renderer completion", async () => {
    const subject = setup();
    await ready(subject);
    let complete: (value: HealthTransaction) => void = (_value) => undefined;
    subject.api.write.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    stage(subject);
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = subject.result.current.save();
    });
    const operationId = subject.api.write.mock.calls[0]![0].operationId;
    subject.unmount();
    subject.api.state.mockResolvedValue({
      enabled: true,
      state: "pending",
      canonical: null,
      pending: {
        operationId,
        fingerprint: session.fingerprint,
        intent: { playerId: "111", before: 80, health: 17 },
      },
    });
    const restored = renderHook(() =>
      useTauriHealth(session, players, subject.accept, subject.api),
    );
    await waitFor(() => expect(restored.result.current.phase).toBe("recovery"));
    expect(restored.result.current.pending).toMatchObject({
      entity: "111",
      before: 80,
      after: 17,
      subject: "Alpha",
    });
    await act(async () => {
      complete(transaction(operationId, "applied"));
      await saving;
    });
    expect(subject.api.recover).not.toHaveBeenCalled();
    expect(restored.result.current.phase).toBe("recovery");
  });

  it("blocks conflicting evidence and requires a canonical result before clearing intent", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.recover.mockImplementation(async (_save, id) => transaction(id, "applied"));
    stage(subject);
    await act(() => subject.result.current.save());
    expect(subject.result.current.phase).toBe("conflict");
    expect(subject.result.current.pending?.after).toBe(17);
    expect(subject.result.current.locked).toBe(true);
    await act(() => subject.result.current.save());
    expect(subject.api.write).toHaveBeenCalledOnce();
  });

  it("keeps normal and unavailable native authority read-only", async () => {
    const subject = setup();
    await ready(subject);
    subject.api.state.mockResolvedValue({
      enabled: false,
      state: "disabled",
      pending: null,
      canonical: null,
    });
    await act(() => subject.result.current.refresh());
    expect(subject.result.current.phase).toBe("conflict");
    stage(subject);
    await act(() => subject.result.current.save());
    expect(subject.api.write).not.toHaveBeenCalled();
  });
});
