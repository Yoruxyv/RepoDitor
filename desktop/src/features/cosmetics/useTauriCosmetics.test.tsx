import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { disabledMeta, type MetaResult, type MetaState } from "@/app/tauriMetaApi";
import { cosmetics } from "@/test/repoditorApiFixture";
import { useTauriCosmetics } from "./useTauriCosmetics";

function state(): MetaState {
  return {
    ...disabledMeta(),
    state: "idle",
    view: structuredClone(cosmetics),
    namespace: "d".repeat(64),
    session: "independent-meta-session",
    admission: {
      manifest: "f".repeat(64),
      identity: "synthetic",
      build: "26294889",
      digest: "a".repeat(64),
    },
  };
}
function api(initial = state()) {
  return {
    state: vi.fn().mockResolvedValue(initial),
    write: vi.fn().mockResolvedValue({ status: "uncertain" }),
    recover: vi.fn().mockResolvedValue({ status: "conflict" }),
  };
}
describe("independent synthetic MetaSave drafts", () => {
  it("stages only eligible exact IDs, preserves unsupported ownership and reverts without writes", async () => {
    const backend = api();
    const { result } = renderHook(() => useTauriCosmetics(true, 0, backend));
    await waitFor(() => expect(result.current.state.session).toBe("independent-meta-session"));
    const target = cosmetics.cosmetics.find((c) => c.known && !c.owned)!;
    act(() => {
      result.current.stage("unlockIds", 999);
      result.current.stage("unlockIds", target.id);
    });
    expect(result.current.pendingEdits).toHaveLength(1);
    expect(result.current.view?.cosmetics.find((c) => c.id === 999)?.owned).toBe(true);
    expect(backend.write).not.toHaveBeenCalled();
    act(() => result.current.revert());
    expect(result.current.pendingEdits).toHaveLength(0);
    expect(backend.write).not.toHaveBeenCalled();
  });
  it("response loss blocks editing until explicit reconciliation and uses only recovery authority", async () => {
    const initial = state();
    const backend = api(initial);
    const { result } = renderHook(() => useTauriCosmetics(true, 0, backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.stage("unlockAll"));
    await act(() => result.current.save());
    expect(result.current.recovery).toBe(true);
    expect(result.current.locked).toBe(true);
    expect(backend.recover).not.toHaveBeenCalled();
    const id = backend.write.mock.calls[0]![0].operationId as string;
    const pending: MetaState = {
      ...initial,
      state: "pending",
      session: null,
      recoverySession: "recovery-only",
      admission: null,
      pending: {
        operationId: id,
        fingerprint: cosmetics.fingerprint,
        status: "unchanged",
        backupAvailable: false,
        proof: "e".repeat(64),
        intent: null,
      },
    };
    backend.state
      .mockResolvedValueOnce(pending)
      .mockResolvedValue({ ...initial, admission: null, session: null });
    backend.recover.mockResolvedValue({
      status: "unchanged",
      view: cosmetics,
      fingerprint: cosmetics.fingerprint,
    } satisfies Partial<MetaResult>);
    await act(() => result.current.reconcile());
    expect(backend.recover).toHaveBeenCalledWith(id, "recovery-only");
    expect(result.current.recovery).toBe(false);
    expect(result.current.state.session).toBeNull();
    const retained = result.current.intent;
    expect(retained).not.toBeNull();
    act(() => result.current.stage("unlockAll"));
    expect(result.current.intent).toEqual(retained);
    expect(backend.write).toHaveBeenCalledOnce();
    act(() => result.current.revert());
    expect(result.current.intent).toBeNull();
  });
  it("fresh hosts rediscover pending evidence without a Run session; conflicts preserve it", async () => {
    const initial: MetaState = {
      ...state(),
      state: "pending",
      session: null,
      recoverySession: "r",
      pending: {
        operationId: "a".repeat(32),
        fingerprint: cosmetics.fingerprint,
        status: "unchanged",
        backupAvailable: false,
        proof: "e".repeat(64),
        intent: { metaCosmetics: { action: "unlockIds", admission: "a".repeat(64), ids: [0, 2] } },
      },
    };
    const backend = api(initial);
    const { result } = renderHook(() => useTauriCosmetics(true, 0, backend));
    await waitFor(() => expect(result.current.recovery).toBe(true));
    expect(result.current.pendingEdits.map((e) => e.entity)).toEqual(["0", "2"]);
    expect(result.current.locked).toBe(true);
    await act(() => result.current.reconcile());
    expect(result.current.recovery).toBe(true);
    expect(result.current.error).toBe("health.conflict");
    expect(backend.write).not.toHaveBeenCalled();
  });
  it("unmount during inspection cannot acknowledge recovery", async () => {
    const backend = api();
    const { result, unmount } = renderHook(() => useTauriCosmetics(true, 0, backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolve!: (value: MetaState) => void;
    backend.state.mockImplementationOnce(
      () =>
        new Promise<MetaState>((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.reconcile();
    });
    unmount();
    await act(async () => {
      resolve({ ...state(), state: "pending", pending: null });
      await pending;
    });
    expect(backend.recover).not.toHaveBeenCalled();
  });
  it("blocks staging during refresh so a late session cannot invalidate a new draft", async () => {
    const backend = api();
    const { result } = renderHook(() => useTauriCosmetics(true, 0, backend));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolve!: (value: MetaState) => void;
    backend.state.mockImplementationOnce(
      () =>
        new Promise<MetaState>((done) => {
          resolve = done;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });
    expect(result.current.locked).toBe(true);
    act(() => result.current.stage("unlockAll"));
    expect(result.current.intent).toBeNull();
    await act(async () => {
      resolve({ ...state(), session: "fresh-meta-session" });
      await refresh;
    });
    expect(result.current.state.session).toBe("fresh-meta-session");
    act(() => result.current.stage("unlockAll"));
    expect(result.current.intent?.metaCosmetics.action).toBe("unlockAll");
  });
});
