import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedSaveDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { ItemsView } from "./ItemsView";

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
  ],
  items: [
    {
      saveKey: "Item Melee Inflatable Hammer/1",
      name: "Melee Inflatable Hammer",
      instanceId: "1",
      isUpgrade: false,
      storedCharge: 99,
      chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true, iconToken: null,
    },
  ],
  unlinkedChargeEntryCount: 0,
};

describe("ItemsView", () => {
  const handlers = {
    pendingByItem: {},
    onRefillAllToFull: vi.fn(),
    onRefillToFull: vi.fn(),
    onRetry: vi.fn(),
    onRevertRefill: vi.fn(),
  };

  it("uses an item-group skeleton only while initial item data is unavailable", () => {
    const { rerender } = renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={null}
        error={null}
        loading
      />,
    );

    expect(screen.getByTestId("items-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('[data-skeleton-kind="item-group"]')).toHaveLength(3);
    expect(screen.getByTestId("item-thumbnail-skeleton")).toBeTruthy();
    expect(screen.queryByText("Loading items…")).toBeNull();

    rerender(
      <ItemsView
        {...handlers}
        advanced={advanced}
        error={null}
        loading={false}
      />,
    );
    expect(screen.queryByTestId("items-skeleton")).toBeNull();
    expect(screen.getByTestId("item-group-Melee Inflatable Hammer")).toBeTruthy();
  });

  it("renders confirmed items, charge, and the evidence-backed refill action", async () => {
    const user = userEvent.setup();
    const refill = vi.fn();
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={advanced}
        error={null}
        loading={false}
        onRefillToFull={refill}
      />,
    );

    expect(screen.getByRole("heading", { name: "Items" })).toBeTruthy();
    const item = screen.getByTestId("item-instance-Item Melee Inflatable Hammer/1");
    expect(screen.getByRole("heading", { name: "Melee Inflatable Hammer" })).toBeTruthy();
    expect(within(item).getByText("Current charge: 99")).toBeTruthy();
    expect(screen.getByText(
      "Recharge appears only for tools RepoDitor can safely refill.",
    )).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByText("#1")).toBeNull();
    expect(screen.queryByText("Item Melee Inflatable Hammer/1")).toBeNull();
    expect(document.querySelector("details")).toBeNull();

    await user.click(within(item).getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }));
    expect(refill).toHaveBeenCalledWith(advanced.items[0]);
  });

  it("shows a local item thumbnail without changing item identity", () => {
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [{ ...advanced.items[0]!, iconToken: "item-token" }],
        }}
        error={null}
        loading={false}
      />,
    );

    const icon = screen.getByTestId("item-icon-Item Melee Inflatable Hammer/1");
    expect(icon.getAttribute("data-icon-source")).toBe("local");
    expect(icon.querySelector("img")?.getAttribute("src"))
      .toBe("repoditor-icon://local/item-token");
    expect(screen.getByRole("heading", { name: "Melee Inflatable Hammer" })).toBeTruthy();
  });

  it("groups duplicate names and filters by game-derived item name", async () => {
    const user = userEvent.setup();
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Gun Tranq/1", name: "Gun Tranq", instanceId: "1", isUpgrade: false, storedCharge: 42, chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true, iconToken: null },
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/3", name: "Cart Medium", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
          ],
        }}
        error={null}
        loading={false}
      />,
    );

    const tranqGroup = screen.getByTestId("item-group-Gun Tranq");
    expect(within(tranqGroup).getByLabelText("2 items")).toBeTruthy();
    expect(within(tranqGroup).queryByText("#1")).toBeNull();
    expect(within(tranqGroup).queryByText("#2")).toBeNull();

    const search = screen.getByRole("searchbox", { name: "Search items" });
    await user.type(search, "  TRANQ  ");
    expect(screen.getByText("2 matching items")).toBeTruthy();
    expect(screen.queryByTestId("item-group-Melee Inflatable Hammer")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear item search" }));
    expect(document.activeElement).toBe(search);
    await user.type(search, "missing");
    expect(screen.getByText("No items match this search.")).toBeTruthy();
  });

  it("reports pending items hidden by a filter", async () => {
    const user = userEvent.setup();
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Cart Medium/3", name: "Cart Medium", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
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
            subject: "Melee Inflatable Hammer",
          },
        }}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search items" }), "cart");
    expect(screen.getByText(/1 matching item · 1 pending item hidden by filter/)).toBeTruthy();
  });

  it("filters by recharge availability and sorts groups without exposing instance IDs", async () => {
    const user = userEvent.setup();
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Gun Tranq/1", name: "Gun Tranq", instanceId: "1", isUpgrade: false, storedCharge: 42, chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true, iconToken: null },
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/1", name: "Cart Medium", instanceId: "1", isUpgrade: false, storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/2", name: "Cart Medium", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/3", name: "Cart Medium", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Future Tool/4", name: "Future Tool", instanceId: "4", isUpgrade: false, storedCharge: 7, chargeState: "stored", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Modded Boost/1", name: "Modded Boost", instanceId: "1", isUpgrade: true, storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
          ],
        }}
        error={null}
        loading={false}
      />,
    );

    const filter = screen.getByRole("combobox", { name: "Filter" });
    await user.selectOptions(filter, "rechargeable");
    expect(screen.getByTestId("item-group-Gun Tranq")).toBeTruthy();
    expect(screen.queryByTestId("item-group-Cart Medium")).toBeNull();
    expect(screen.queryByTestId("item-group-Future Tool")).toBeNull();

    await user.selectOptions(filter, "not_rechargeable");
    const cart = screen.getByTestId("item-group-Cart Medium");
    expect(cart).toBeTruthy();
    expect(within(cart).queryByRole("list")).toBeNull();
    expect(screen.queryByTestId("item-group-Future Tool")).toBeNull();
    expect(screen.queryByTestId("item-group-Gun Tranq")).toBeNull();

    await user.selectOptions(filter, "upgrades");
    expect(screen.getByTestId("item-group-Modded Boost")).toBeTruthy();
    expect(screen.queryByTestId("item-group-Cart Medium")).toBeNull();

    await user.selectOptions(filter, "all");
    expect(screen.getByTestId("item-group-Future Tool")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "quantity-desc");
    expect(screen.getAllByTestId(/^item-group-/)[0]?.getAttribute("data-testid"))
      .toBe("item-group-Cart Medium");
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });

  it("offers one bulk recharge action only while an eligible tool is unstaged", async () => {
    const user = userEvent.setup();
    const refillAll = vi.fn();
    const { unmount } = renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={advanced}
        error={null}
        loading={false}
        onRefillAllToFull={refillAll}
      />,
    );

    const bulk = screen.getByRole("button", { name: "Recharge All Tools" });
    expect((bulk as HTMLButtonElement).disabled).toBe(false);
    await user.click(bulk);
    expect(refillAll).toHaveBeenCalledOnce();
    unmount();

    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/3", name: "Cart Medium", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
          ],
        }}
        error={null}
        loading={false}
      />,
    );
    expect((screen.getByRole("button", { name: "Recharge All Tools" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("renders explicit charge states without guessing or enabling unsupported actions", () => {
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Cart Medium/3", name: "Cart Medium", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Health Pack Medium/4", name: "Health Pack Medium", instanceId: "4", isUpgrade: false, storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
          ],
        }}
        error={null}
        loading={false}
      />,
    );

    expect(screen.getByTestId("item-instance-Item Melee Inflatable Hammer/1").textContent)
      .toContain("Current charge: 99");
    expect(screen.getByTestId("item-instance-Item Gun Tranq/2").textContent)
      .toContain("Full");
    expect(within(screen.getByTestId("item-group-Cart Medium")).queryByText(/Charge|Full/))
      .toBeNull();
    expect(within(screen.getByTestId("item-group-Health Pack Medium")).queryByText(/Charge|Full/))
      .toBeNull();
    expect(screen.getAllByRole("button", { name: /Recharge .*tool/ })).toHaveLength(1);
  });

  it("targets the exact stored instance inside a duplicate group", async () => {
    const user = userEvent.setup();
    const refill = vi.fn();
    const second = {
      saveKey: "Item Gun Tranq/2",
      name: "Gun Tranq",
      instanceId: "2",
      isUpgrade: false,
      storedCharge: 17,
      chargeState: "stored" as const,
      rechargeCapability: "rechargeable" as const,
      canRefillToFull: true, iconToken: null,
    };
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            { ...second, saveKey: "Item Gun Tranq/1", instanceId: "1", isUpgrade: false, storedCharge: 42 },
            second,
          ],
        }}
        error={null}
        loading={false}
        onRefillToFull={refill}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Recharge Gun Tranq, tool 2" }));
    expect(refill).toHaveBeenCalledWith(second);
  });

  it("distinguishes unsupported and supported-empty item structures", () => {
    const { rerender } = renderWithPreferences(
      <ItemsView
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
    expect(screen.getByText("Items are unavailable for this save."))
      .toBeTruthy();

    rerender(
      <ItemsView
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
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            ...advanced.items,
            { saveKey: "Item Gun Handgun/2", name: "Gun Handgun", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
            { saveKey: "Item Future Tool/3", name: "Future Tool", instanceId: "3", isUpgrade: false, storedCharge: null, chargeState: "unknown", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
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
    renderWithPreferences(
      <ItemsView
        {...handlers}
        advanced={{
          ...advanced,
          items: [
            advanced.items[0]!,
            { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", isUpgrade: false, storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
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
            subject: "Melee Inflatable Hammer",
          },
        }}
        onRevertRefill={revert}
      />,
    );

    expect(screen.getAllByText("Full")).toHaveLength(2);
    expect(screen.getByText("Pending: 99 → Full")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Recharge .*tool/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revert recharge" }));
    expect(revert).toHaveBeenCalledWith("Item Melee Inflatable Hammer/1");
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("reports bridge errors and retries", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    renderWithPreferences(
      <ItemsView
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
