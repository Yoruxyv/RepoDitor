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
  canRefillToFull: false,
};

const advanced: AdvancedSaveDto = {
  domains: [
    { key: "items", label: "Item instances", status: "confirmed", entryCount: 1, capabilities: readOnly },
    { key: "currentCharge", label: "Stored charge entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnly, canRefillToFull: true } },
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
  const handlers = {
    pendingByItem: {},
    onRefillToFull: vi.fn(),
    onRetry: vi.fn(),
    onRevertRefill: vi.fn(),
  };

  it("renders confirmed items, charge, and the evidence-backed refill action", async () => {
    const user = userEvent.setup();
    const refill = vi.fn();
    render(
      <AdvancedView
        {...handlers}
        advanced={advanced}
        error={null}
        loading={false}
        onRefillToFull={refill}
      />,
    );

    expect(screen.getByRole("heading", { name: "Items" })).toBeTruthy();
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Melee Inflatable Hammer #1")).toBeTruthy();
    expect(within(item).getByText("99")).toBeTruthy();
    expect(screen.getByText(
      "Only the evidence-backed Refill to Full action is writable. All unverified item mutations remain unavailable.",
    )).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();

    await user.click(within(item).getByRole("button", { name: "Refill Melee Inflatable Hammer #1 to full" }));
    expect(refill).toHaveBeenCalledWith(advanced.items[0]);

    await user.click(within(item).getByText("Show save key"));
    expect(within(item).getByText("Item Melee Inflatable Hammer/1")).toBeTruthy();
  });

  it("distinguishes unsupported and supported-empty item structures", () => {
    const { rerender } = render(
      <AdvancedView
        {...handlers}
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
      />,
    );
    expect(screen.getByText("This save does not contain the confirmed item-instance container."))
      .toBeTruthy();

    rerender(
      <AdvancedView
        {...handlers}
        advanced={{
          ...advanced,
          domains: advanced.domains.map((domain) =>
            domain.key === "items" ? { ...domain, entryCount: 0 } : domain,
          ),
          items: [],
        }}
        error={null}
        loading={false}
      />,
    );
    expect(screen.getByText("This save contains no item instances.")).toBeTruthy();
  });

  it("uses specific, category, and generic item icon fallbacks", () => {
    render(
      <AdvancedView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            ...advanced.items,
            { saveKey: "Item Gun Handgun/2", name: "Gun Handgun", instanceId: "2", storedCharge: null },
            { saveKey: "Item Future Tool/3", name: "Future Tool", instanceId: "3", storedCharge: null },
          ],
        }}
        error={null}
        loading={false}
      />,
    );

    expect(screen.getByTestId("item-icon-Item Melee Inflatable Hammer/1").dataset.iconSource)
      .toBe("specific");
    expect(screen.getByTestId("item-icon-Item Gun Handgun/2").dataset.iconSource)
      .toBe("category");
    expect(screen.getByTestId("item-icon-Item Future Tool/3").dataset.iconSource)
      .toBe("fallback");
  });

  it("shows pending and canonical full states without numeric editing", async () => {
    const user = userEvent.setup();
    const revert = vi.fn();
    render(
      <AdvancedView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", storedCharge: null },
          ],
        }}
        error={null}
        loading={false}
        pendingByItem={{
          "Item Melee Inflatable Hammer/1": {
            feature: "advanced",
            entity: "Item Melee Inflatable Hammer/1",
            field: "refillToFull",
            after: true,
            before: 99,
            label: "Stored charge",
            subject: "Melee Inflatable Hammer #1",
          },
        }}
        onRevertRefill={revert}
      />,
    );

    expect(screen.getAllByText("Full / Default")).toHaveLength(2);
    expect(screen.getByText("Pending: 99 → Full / Default")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Refill .* to full/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revert refill" }));
    expect(revert).toHaveBeenCalledWith("Item Melee Inflatable Hammer/1");
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("reports bridge errors and retries", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <AdvancedView
        {...handlers}
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
