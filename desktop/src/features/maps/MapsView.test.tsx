import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledMapsDto } from "@/app/desktopContracts";
import { cancelEntryArtwork, preloadEntryArtwork } from "@/app/tauriArtwork";
import { renderWithPreferences } from "@/test/render";
import { MapsView } from "./MapsView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const iconToken = `map-artwork:${"a".repeat(32)}`;
const nativeMap = {
  token: iconToken,
  revision: "a".repeat(64),
  dataUrl: "data:image/png;base64,AAAA",
};

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ ok: true, data: nativeMap });
});
afterEach(cancelEntryArtwork);

async function renderedMap() {
  return waitFor(() => {
    const image = screen.getByTestId("map-artwork-Arctic").querySelector("img");
    expect(image).toBeTruthy();
    return image!;
  });
}

async function prepareMap() {
  await preloadEntryArtwork(
    { map: [iconToken], upgrade: [], item: [] },
    new AbortController().signal,
  );
}

const maps: InstalledMapsDto = {
  available: true,
  catalogPath: "C:\\fixture\\catalog.json",
  maps: [
    { internalName: "Arctic", displayName: "McJannek Station", knownLabel: true, iconToken: null },
  ],
};

describe("MapsView", () => {
  it("uses map-card skeletons only while installed metadata is unavailable", () => {
    const { rerender } = renderWithPreferences(
      <MapsView discovery={null} error={null} loading onRetry={vi.fn()} />,
    );

    expect(screen.getByTestId("maps-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('[data-skeleton-kind="map-card"]')).toHaveLength(6);
    expect(screen.queryByText("Discovering installed maps…")).toBeNull();

    rerender(<MapsView discovery={maps} error={null} loading onRetry={vi.fn()} />);
    expect(screen.queryByTestId("maps-skeleton")).toBeNull();
    expect(screen.getByText("McJannek Station")).toBeTruthy();
  });
  it("keeps previews decorative, shows per-image loading, and immediately falls back on errors", async () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken }] };
    const { rerender } = renderWithPreferences(
      <MapsView discovery={local} error={null} loading={false} onRetry={vi.fn()} />,
    );
    const frame = screen.getByTestId("map-artwork-Arctic");
    const image = await renderedMap();
    expect(image.getAttribute("alt")).toBe("");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("map-artwork-Arctic-loading")).toBeTruthy();
    fireEvent.load(image);
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
    rerender(
      <MapsView discovery={local} error="Refresh failed" loading={false} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "McJannek Station" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Refresh failed");
    fireEvent.error(image);
    expect(screen.getByTestId("map-artwork-Arctic").querySelector("img")).toBeNull();
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
  });

  it("does not flash a skeleton when reopening a ready preview", async () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken }] };
    await prepareMap();
    const first = renderWithPreferences(
      <MapsView discovery={local} error={null} loading={false} onRetry={vi.fn()} />,
    );
    fireEvent.load(await renderedMap());
    first.unmount();
    renderWithPreferences(
      <MapsView discovery={local} error={null} loading={false} onRetry={vi.fn()} />,
    );
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" }).getAttribute("disabled")).toBeNull();
  });

  it("uses immediate fallbacks for unmapped maps and preserves cards during refresh", () => {
    const retry = vi.fn();
    renderWithPreferences(<MapsView discovery={maps} error={null} loading onRetry={retry} />);
    expect(screen.getByTestId("map-artwork-Arctic").getAttribute("data-icon-source")).toBe(
      "fallback",
    );
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
    expect(screen.getByRole("button", { name: "Refreshing" }).hasAttribute("disabled")).toBe(true);
  });
  it("retries a failed preview after refresh without skeletonizing an already ready preview", async () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken }] };
    const props = { discovery: local, error: null, loading: false, onRetry: vi.fn() };
    const { rerender } = renderWithPreferences(<MapsView {...props} />);
    fireEvent.error(await renderedMap());
    expect(screen.getByTestId("map-artwork-Arctic").getAttribute("data-icon-source")).toBe(
      "fallback",
    );
    rerender(<MapsView {...props} artworkAttempt={1} />);
    const image = await renderedMap();
    expect(image).toBeTruthy();
    expect(screen.getByTestId("map-artwork-Arctic-loading")).toBeTruthy();
    fireEvent.load(image);
    await act(prepareMap);
    rerender(<MapsView {...props} artworkAttempt={2} />);
    expect(screen.getByTestId("map-artwork-Arctic").querySelector("img")).toBeTruthy();
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
  });
});
