import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedSaveDto } from "@electron/contracts";
import { AdvancedView } from "./AdvancedView";

const readOnly = {
  canRead: true,
  canEdit: false as const,
  canAdd: false as const,
  canDelete: false as const,
  canDuplicate: false as const,
};

const advanced: AdvancedSaveDto = {
  domains: [
    { key: "items", label: "Item instances", status: "confirmed", entryCount: 1, capabilities: readOnly },
    { key: "currentCharge", label: "Stored charge entries", status: "partially_confirmed", entryCount: 1, capabilities: readOnly },
    { key: "batteryUpgrades", label: "Battery upgrade entries", status: "unknown", entryCount: 0, capabilities: { ...readOnly, canRead: false } },
    { key: "purchasedUpgrades", label: "Purchased upgrade entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnly, canRead: false } },
    { key: "purchasedItems", label: "Purchased item entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnly, canRead: false } },
    { key: "purchasedItemsTotal", label: "Total purchased item entries", status: "partially_confirmed", entryCount: 2, capabilities: { ...readOnly, canRead: false } },
    { key: "runMetadata", label: "Additional Run values", status: "partially_confirmed", entryCount: 1, capabilities: readOnly },
  ],
  items: [
    {
      saveKey: "Item Melee Inflatable Hammer/1",
      name: "Melee Inflatable Hammer",
      instanceId: "1",
      storedCharge: 99,
    },
  ],
  runValues: [
    {
      saveKey: "chargingStationCharge",
      label: "Charging station charge",
      value: 10,
      status: "partially_confirmed",
    },
  ],
  unlinkedChargeEntryCount: 0,
};

describe("AdvancedView", () => {
  it("renders confirmed items, counts, charge, and exact-key disclosure read-only", async () => {
    const user = userEvent.setup();
    render(<AdvancedView advanced={advanced} error={null} loading={false} onRetry={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Items" })).toBeTruthy();
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Melee Inflatable Hammer")).toBeTruthy();
    expect(within(item).getByText("99")).toBeTruthy();
    expect(screen.getByText("No item changes can be created or saved in this phase.")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();

    await user.click(within(item).getByText("Show save key"));
    expect(within(item).getByText("Item Melee Inflatable Hammer/1")).toBeTruthy();
  });

  it("distinguishes unsupported and supported-empty item structures", () => {
    const { rerender } = render(
      <AdvancedView
        advanced={{
          ...advanced,
          domains: advanced.domains.map((domain) =>
            domain.key === "items"
              ? { ...domain, status: "unknown", entryCount: null, capabilities: { ...readOnly, canRead: false } }
              : domain,
          ),
          items: [],
        }}
        error={null}
        loading={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("This save does not contain the confirmed item-instance container."))
      .toBeTruthy();

    rerender(
      <AdvancedView
        advanced={{
          ...advanced,
          domains: advanced.domains.map((domain) =>
            domain.key === "items" ? { ...domain, entryCount: 0 } : domain,
          ),
          items: [],
        }}
        error={null}
        loading={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("This save contains no item instances.")).toBeTruthy();
  });

  it("reports bridge errors and retries", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <AdvancedView
        advanced={null}
        error="Advanced data failed."
        loading={false}
        onRetry={retry}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Advanced data failed.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
