import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InstalledMapsDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { MapsView } from "./MapsView";

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
  it("keeps previews decorative, shows per-image loading, and immediately falls back on errors", () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken: "map-ready-token" }] };
    const { rerender } = renderWithPreferences(
      <MapsView discovery={local} error={null} loading={false} onRetry={vi.fn()} />,
    );
    const frame = screen.getByTestId("map-artwork-Arctic");
    const image = frame.querySelector("img")!;
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

  it("does not flash a skeleton when reopening a ready preview", () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken: "map-remount-token" }] };
    const first = renderWithPreferences(
      <MapsView discovery={local} error={null} loading={false} onRetry={vi.fn()} />,
    );
    fireEvent.load(screen.getByTestId("map-artwork-Arctic").querySelector("img")!);
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
  it("retries a failed preview after refresh without skeletonizing an already ready preview", () => {
    const local = { ...maps, maps: [{ ...maps.maps[0]!, iconToken: "map-retry-token" }] };
    const props = { discovery: local, error: null, loading: false, onRetry: vi.fn() };
    const { rerender } = renderWithPreferences(<MapsView {...props} />);
    fireEvent.error(screen.getByTestId("map-artwork-Arctic").querySelector("img")!);
    expect(screen.getByTestId("map-artwork-Arctic").getAttribute("data-icon-source")).toBe(
      "fallback",
    );
    rerender(<MapsView {...props} artworkAttempt={1} />);
    const image = screen.getByTestId("map-artwork-Arctic").querySelector("img")!;
    expect(image).toBeTruthy();
    expect(screen.getByTestId("map-artwork-Arctic-loading")).toBeTruthy();
    fireEvent.load(image);
    rerender(<MapsView {...props} artworkAttempt={2} />);
    expect(screen.getByTestId("map-artwork-Arctic").querySelector("img")).toBeTruthy();
    expect(screen.queryByTestId("map-artwork-Arctic-loading")).toBeNull();
  });
});
