import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InstalledMapsDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { MapsView } from "./MapsView";

const maps: InstalledMapsDto = {
  available: true,
  catalogPath: "C:\\fixture\\catalog.json",
  maps: [{ internalName: "Arctic", displayName: "McJannek Station", knownLabel: true }],
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
});
