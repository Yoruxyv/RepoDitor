import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { inspectMetaCosmetics, KNOWN_COSMETIC_IDS } from "@/features/cosmetics/cosmetics";
import { encryptEs3 } from "@/features/save-file/es3";
import { loadSaveBytes } from "@/features/save-file/pipeline";
import {
  isSaveNumber,
  isSaveObject,
  parseSaveJson,
  serializeSaveJson,
} from "@/features/save-file/serialization";
import { inspectRunSave } from "@/features/run-save/runSave";

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const cosmeticCount = KNOWN_COSMETIC_IDS.length;

function button(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
  return element;
}

function input(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected an input element.");
  return element;
}

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor?: PropertyDescriptor,
) {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    Reflect.deleteProperty(URL, name);
  }
}

function installDownloadMocks() {
  const createObjectURL = vi.fn((_blob: Blob) => "blob:verified");
  const revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  return { click, createObjectURL, revokeObjectURL };
}

interface RunFileOptions {
  readonly charges?: Readonly<Record<string, unknown>>;
  readonly items?: Readonly<Record<string, unknown>>;
  readonly playerIds?: readonly [string, string];
  readonly resumeValue?: number;
}

async function runFile({
  charges = {
    "Item Cart Medium/3": 44,
    "Item Future Battery/4": 88,
    "Item Gun Tranq/1": 0,
    "Item Melee Inflatable Hammer/2": 20,
  },
  items = {
    "Item Cart Medium/3": 2,
    "Item Future Battery/4": 7,
    "Item Gun Tranq/1": 15,
    "Item Melee Inflatable Hammer/2": 21,
  },
  playerIds = ["111", "222"],
  resumeValue = 0,
}: RunFileOptions = {}): Promise<File> {
  const [alphaId, betaId] = playerIds;
  const plaintext = JSON.stringify({
    playerNames: { value: { [alphaId]: "Alpha", [betaId]: "Beta User" } },
    dictionaryOfDictionaries: {
      value: {
        runStats: {
          currency: 12,
          level: 0,
          privateUnknown: "kept-local",
          "save level": resumeValue,
        },
        playerHealth: { [alphaId]: 80, [betaId]: 60 },
        playerUpgradeHealth: { [alphaId]: 1, [betaId]: 0 },
        playerUpgradeStrength: { [alphaId]: 2 },
        item: items,
        itemStatBattery: charges,
      },
    },
  });
  const encrypted = await encryptEs3(new TextEncoder().encode(plaintext), {
    testIv: new Uint8Array(16),
  });
  const file = new File([encrypted], "REPO_SAVE.es3");
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn(async () => encrypted.buffer),
  });
  return file;
}

const STEAM_PLAYER_IDS = ["76561197960287930", "76561198000000001"] as const;

function avatarEndpointResponse(avatars: Record<string, string>): Response {
  return Response.json({ avatars });
}

async function metaFile(
  unlocks: readonly number[] = [27],
  presets: readonly unknown[] = [[]],
): Promise<File> {
  const plaintext = JSON.stringify({
    cosmeticHistory: { value: unlocks },
    cosmeticUnlocks: { value: unlocks },
    cosmeticPresets: { value: presets },
    colorPresets: { value: [[1, 2], []] },
    unrelated: { future: "preserved" },
  });
  const encrypted = await encryptEs3(new TextEncoder().encode(plaintext), {
    testIv: new Uint8Array(16),
  });
  const file = new File([encrypted], "MetaSave.es3");
  Object.defineProperty(file, "arrayBuffer", { value: async () => encrypted.buffer });
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreUrlMethod("createObjectURL", createObjectUrlDescriptor);
  restoreUrlMethod("revokeObjectURL", revokeObjectUrlDescriptor);
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeReady;
  delete document.documentElement.dataset.locale;
  document.documentElement.lang = "en";
});

describe("App", () => {
  it("presents the local save entry point and Desktop alternative", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "R.E.P.O. Save Editor — directly in your browser.",
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Save contents are processed locally and are not persisted/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/save files and decrypted JSON are not uploaded/i)).toBeTruthy();
    expect(screen.getByText("or choose a supported .es3 save")).toBeTruthy();
    expect(screen.queryByText("or choose a .es3 file")).toBeNull();
    const supportedTypes = document.querySelector("#supported-save-types");
    expect(supportedTypes).not.toBeNull();
    expect(within(supportedTypes as HTMLElement).getByText("Run saves")).toBeTruthy();
    expect(within(supportedTypes as HTMLElement).getByText("MetaSave.es3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find my save" })).toBeTruthy();
    expect(screen.getByText("Prefer automatic save discovery?")).toBeTruthy();

    const fileInput = screen.getByLabelText(/drop a save here/i);
    expect(fileInput.getAttribute("type")).toBe("file");
    expect(fileInput.getAttribute("accept")).toBe(".es3");

    expect(screen.getByRole("link", { name: /get repoditor desktop/i }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor/releases/latest",
    );
  });

  it("persists only an explicit theme preference and exposes the flagless language menu", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<App />);

    expect(storageWrite).not.toHaveBeenCalled();
    const languageTrigger = screen.getByRole("button", { name: "Language: English" });
    expect(document.body.textContent).not.toContain("🇺🇸");
    fireEvent.click(languageTrigger);
    const languageOption = screen.getByRole("option", { name: "English" });
    expect(languageOption.className).toContain("w-full");
    fireEvent.keyDown(languageOption, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Language" })).toBeNull();
    expect(document.activeElement).toBe(languageTrigger);

    const themeToggle = screen.getByRole("button", { name: "Switch to light theme" });
    const moon = themeToggle.querySelector('[data-theme-icon="moon"]');
    const sun = themeToggle.querySelector('[data-theme-icon="sun"]');
    expect(moon?.classList.contains("is-visible")).toBe(true);
    expect(sun?.classList.contains("is-visible")).toBe(false);
    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(storageWrite).toHaveBeenCalledWith("repoditor-theme", "light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
    expect(moon?.classList.contains("is-visible")).toBe(false);
    expect(sun?.classList.contains("is-visible")).toBe(true);
  });

  it("opens hash-addressable policy guidance and returns focus on browser Back", async () => {
    render(<App />);
    const trigger = screen.getByRole("link", { name: "Data & Privacy" });

    trigger.focus();
    fireEvent.click(trigger);
    expect(window.location.hash).toBe("#privacy");
    const dialog = document.querySelector('[aria-labelledby="policy-title"]');
    expect(dialog?.hasAttribute("open")).toBe(true);
    await waitFor(() => expect((dialog as HTMLDialogElement).dataset.state).toBe("open"));
    expect(screen.getByRole("heading", { name: "Data & Privacy" })).toBeTruthy();

    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(dialog?.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
  });

  it("reads and classifies a selected save without exposing its data", async () => {
    render(<App />);
    const file = await runFile();

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [file] },
    });

    expect(await screen.findByTestId("save-workspace")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "REPO_SAVE.es3" })).toBeTruthy();
    expect(screen.getByText("Run save")).toBeTruthy();
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByTestId("pending-changes-review")).toBeNull();
    expect(screen.getByText("Validated locally")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download verified copy" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Alpha111" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta User222" })).toBeTruthy();
    const identity = screen.getByTestId("selected-player-identity");
    expect(within(identity).getByRole("heading", { name: "Alpha" })).toBeTruthy();
    expect(within(identity).getByText("111")).toBeTruthy();
    expect(screen.getByTestId("player-avatar-fallback").textContent).toBe("A");
    expect(identity.querySelector("img")).toBeNull();
    expect(screen.queryByText("kept-local")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        level: 1,
        name: "R.E.P.O. Save Editor — directly in your browser.",
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /get repoditor desktop/i })).toBeNull();
  });

  it("stages core Run edits in memory and discards them back to the baseline", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");

    fireEvent.change(screen.getByRole("spinbutton", { name: "Current health" }), {
      target: { value: "95" },
    });
    expect(screen.getByText("1 pending change")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Upgrades" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength" }), {
      target: { value: "3" },
    });
    expect(screen.getByText("2 pending changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Currency" }), {
      target: { value: "50000" },
    });
    expect(screen.getByText("3 pending changes")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Run level" }), {
      target: { value: "5" },
    });
    expect(screen.getByText("4 pending changes")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next spawn"));
    fireEvent.click(screen.getByRole("option", { name: "Shop / Service Station" }));

    expect(screen.getByText("5 pending changes")).toBeTruthy();
    const reviewButton = screen.getByRole("button", { name: "Review changes" });
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(reviewButton);
    expect(reviewButton.getAttribute("aria-expanded")).toBe("true");

    const review = screen.getByTestId("pending-changes-review");
    expect(review.hidden).toBe(false);
    expect(
      within(review)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Alpha · Current health80 → 95",
      "Alpha · Strength2 → 3",
      "Run · Run level1 → 5",
      "Run · Currency12 → 50,000",
      "Run · Next spawnNormal → Shop / Service Station",
    ]);
    fireEvent.click(reviewButton);
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
    expect(review.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByTestId("pending-changes-review")).toBeNull();
    await waitFor(() =>
      expect(input(screen.getByRole("spinbutton", { name: "Currency" })).value).toBe("12"),
    );
    expect(screen.getByLabelText("Next spawn").textContent).toContain("Normal");
    expect(input(screen.getByRole("spinbutton", { name: "Run level" })).value).toBe("1");
    fireEvent.click(screen.getByRole("tab", { name: "Players" }));
    expect(input(screen.getByRole("spinbutton", { name: "Current health" })).value).toBe("80");
  });

  it("offers only supported next-spawn choices without normalizing an unsupported value", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile({ resumeValue: 2 })] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Run" }));

    const trigger = screen.getByLabelText("Next spawn");
    expect(trigger.textContent).toContain("Unsupported saved value (2)");
    fireEvent.click(trigger);
    const menu = screen.getByRole("listbox", { name: "Next spawn" });
    expect(
      within(menu)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Normal", "Shop / Service Station"]);
    expect(within(menu).queryByText(/Unsupported saved value/iu)).toBeNull();

    fireEvent.click(within(menu).getByRole("option", { name: "Normal" }));
    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(screen.getByLabelText("Next spawn").textContent).toContain("Normal");
  });

  it("removes a pending edit when the value is manually restored", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    const health = screen.getByRole("spinbutton", { name: "Current health" });

    fireEvent.change(health, { target: { value: "95" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();

    fireEvent.change(health, { target: { value: "80" } });
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(button(screen.getByRole("button", { name: "Discard changes" })).disabled).toBe(true);
  });

  it("keeps one live pending edit per field and removes it at the baseline", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Run" }));
    const currency = screen.getByRole("spinbutton", { name: "Currency" });

    fireEvent.change(currency, { target: { value: "67" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("listitem").textContent).toBe("Run · Currency12 → 67");

    fireEvent.change(currency, { target: { value: "68" } });
    fireEvent.change(currency, { target: { value: "69" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe("Run · Currency12 → 69");

    fireEvent.change(currency, { target: { value: "12" } });
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });

  it("keeps the Desktop-style player selection and tab keyboard navigation accessible", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");

    fireEvent.click(screen.getByRole("button", { name: "Beta User222" }));
    const identity = screen.getByTestId("selected-player-identity");
    expect(within(identity).getByRole("heading", { name: "Beta User" })).toBeTruthy();
    expect(screen.getByTestId("player-avatar-fallback").textContent).toBe("BU");
    expect(input(screen.getByRole("spinbutton", { name: "Current health" })).value).toBe("60");

    const playersTab = screen.getByRole("tab", { name: "Players" });
    fireEvent.keyDown(playersTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Upgrades" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "Upgrades" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Run" }));
    expect(screen.getByRole("spinbutton", { name: "Run level" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Currency" })).toBeTruthy();
    expect(screen.getByLabelText("Next spawn")).toBeTruthy();
  });

  it("recharges supported items as one immediate pending change and discard restores them", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Recharge" }));

    expect(screen.getByText("2 supported rechargeable items")).toBeTruthy();
    expect(screen.getByText("2 items need recharging")).toBeTruthy();
    const recharge = screen.getByRole("button", { name: "Recharge All Supported Items" });
    expect((recharge as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(recharge);

    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(screen.getByText("All supported items fully charged.")).toBeTruthy();
    expect((recharge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("listitem").textContent).toBe(
      "Recharge · Supported items2 items need recharging → All supported items fully charged",
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.getByText("2 items need recharging")).toBeTruthy();
    expect((recharge as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a calm empty recharge state when no supported items are present", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile({ charges: {}, items: {} })] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Recharge" }));

    expect(screen.getByText("0 supported rechargeable items")).toBeTruthy();
    expect(
      screen.getByText("No supported rechargeable items were found in this Run save."),
    ).toBeTruthy();
    expect(
      button(
        screen.getByRole("button", {
          name: "Recharge All Supported Items",
        }),
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Clean")).toBeTruthy();
  });

  it("does not expose recharge mutation for malformed stored charge", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: {
        files: [await runFile({ charges: { "Item Gun Tranq/1": "not-an-integer" } })],
      },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Recharge" }));

    expect(screen.getByRole("heading", { name: "Recharge unavailable" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("signed Int32 integer");
    expect(screen.queryByRole("button", { name: "Recharge All Supported Items" })).toBeNull();
    expect(screen.getByText("Clean")).toBeTruthy();
  });

  it("loads optional Steam avatars automatically and fails independently", async () => {
    const download = installDownloadMocks();
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const avatarUrl = "https://avatars.fastly.steamstatic.com/avatar.jpg";
    let resolveAvatars!: (response: Response) => void;
    const pendingAvatars = new Promise<Response>((resolve) => {
      resolveAvatars = resolve;
    });
    const fetchEndpoint = vi.fn<typeof fetch>().mockReturnValue(pendingAvatars);
    vi.stubGlobal("fetch", fetchEndpoint);
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile({ playerIds: STEAM_PLAYER_IDS })] },
    });
    await screen.findByTestId("save-workspace");

    await waitFor(() => expect(fetchEndpoint).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: /Load Steam avatars/ })).toBeNull();
    expect(screen.getByTestId("player-avatar-fallback").textContent).toBe("A");

    const health = screen.getByRole("spinbutton", { name: "Current health" });
    fireEvent.change(health, { target: { value: "61" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();

    await act(() => {
      resolveAvatars(avatarEndpointResponse({ [STEAM_PLAYER_IDS[1]]: avatarUrl }));
    });

    fireEvent.click(screen.getByRole("button", { name: `Beta User${STEAM_PLAYER_IDS[1]}` }));
    const avatar = await screen.findByRole("img", { name: "Steam avatar for Beta User" });
    expect(avatar.getAttribute("src")).toBe(avatarUrl);
    fireEvent.load(avatar);
    expect(screen.queryByTestId("player-avatar-fallback")).toBeNull();

    fireEvent.error(avatar);
    expect(await screen.findByTestId("player-avatar-fallback")).toBeTruthy();

    const [url, options] = fetchEndpoint.mock.calls[0]!;
    expect(url).toBe("/api/steam-avatars");
    expect(JSON.parse(String(options?.body))).toEqual({ steamIds: STEAM_PLAYER_IDS });
    expect(String(options?.body)).not.toContain("privateUnknown");
    expect(String(options?.body)).not.toContain("playerHealth");
    expect(storageWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Download verified copy" }));
    expect(
      await screen.findByText("REPO_SAVE.repoditor.es3 was verified and downloaded."),
    ).toBeTruthy();
    expect(download.click).toHaveBeenCalledOnce();
  });

  it("keeps invalid Run input out of the working save", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Current health" }), {
      target: { value: "-1" },
    });

    expect((await screen.findByRole("alert")).textContent).toMatch(/between 0 and 2,147,483,647/iu);
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(button(screen.getByRole("button", { name: "Discard changes" })).disabled).toBe(true);
  });

  it("does not stage or overwrite accepted state with invalid numeric drafts", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    const health = screen.getByRole("spinbutton", { name: "Current health" });

    for (const value of ["", "-", "1.5", "2147483648"]) {
      fireEvent.change(health, { target: { value } });
      expect(screen.getByText("Clean")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    }

    fireEvent.change(health, { target: { value: "95" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("listitem").textContent).toBe("Alpha · Current health80 → 95");

    fireEvent.change(health, { target: { value: "2147483648" } });
    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe("Alpha · Current health80 → 95");
  });

  it("downloads only after an explicit click and reports verification", async () => {
    const download = installDownloadMocks();
    render(<App />);
    const file = await runFile();

    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Currency" }), {
      target: { value: "67" },
    });
    expect(screen.getByText("1 pending change")).toBeTruthy();

    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download verified copy" }));

    expect(
      await screen.findByText("REPO_SAVE.repoditor.es3 was verified and downloaded."),
    ).toBeTruthy();
    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.click).toHaveBeenCalledOnce();
    expect(download.revokeObjectURL).toHaveBeenCalledWith("blob:verified");
    const exported = download.createObjectURL.mock.calls[0]?.[0];
    expect(exported).toBeInstanceOf(Blob);
    if (!(exported instanceof Blob)) {
      throw new Error("Expected the verified export Blob.");
    }
    const reopened = await loadSaveBytes(
      new Uint8Array(await exported.arrayBuffer()),
      "REPO_SAVE.repoditor.es3",
    );
    expect(inspectRunSave(reopened.data).currency).toBe(67);
  });

  it("clears sensitive session state and permits selecting the same file again", async () => {
    render(<App />);
    const file = await runFile();

    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByTestId("save-workspace")).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "R.E.P.O. Save Editor — directly in your browser.",
      }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });
    expect(await screen.findByTestId("save-workspace")).toBeTruthy();
  });

  it("replaces the previous session and export status when another file is selected", async () => {
    installDownloadMocks();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await runFile()] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Download verified copy" }));
    await screen.findByText("REPO_SAVE.repoditor.es3 was verified and downloaded.");

    fireEvent.change(screen.getByLabelText("Change file"), {
      target: { files: [await metaFile()] },
    });

    expect(await screen.findByRole("heading", { level: 2, name: "Cosmetics" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "MetaSave.es3" })).toBeTruthy();
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Run editor sections" })).toBeNull();
    expect(screen.queryByText(/REPO_SAVE\.repoditor\.es3 was verified/iu)).toBeNull();
  });

  it("unlocks remaining supported cosmetics with one immediate semantic pending edit", async () => {
    render(<App />);
    const partialIds = [...KNOWN_COSMETIC_IDS.slice(0, -1), 999];
    const partialCount = cosmeticCount - 1;

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await metaFile(partialIds, [[27], [], [999]])] },
    });
    await screen.findByTestId("save-workspace");

    expect(
      screen.getByText(`${partialCount} of ${cosmeticCount} supported cosmetics unlocked`),
    ).toBeTruthy();
    expect(screen.getByText("1 supported cosmetic remains locked.")).toBeTruthy();
    const unlock = screen.getByRole("button", { name: "Unlock Remaining Cosmetics" });
    expect((unlock as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(unlock);

    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(
      screen.getByText(`${cosmeticCount} of ${cosmeticCount} supported cosmetics unlocked`),
    ).toBeTruthy();
    expect(screen.getByText("All supported cosmetics are already unlocked.")).toBeTruthy();
    expect((unlock as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("listitem").textContent).toBe(
      `Cosmetics · Supported cosmetics${partialCount} unlocked → ${cosmeticCount} unlocked`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(
      screen.getByText(`${partialCount} of ${cosmeticCount} supported cosmetics unlocked`),
    ).toBeTruthy();
    expect(
      button(
        screen.getByRole("button", {
          name: "Unlock Remaining Cosmetics",
        }),
      ).disabled,
    ).toBe(false);
  });

  it("shows a clean completed state and does not expose an action for malformed MetaSave data", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await metaFile(KNOWN_COSMETIC_IDS)] },
    });
    await screen.findByTestId("save-workspace");

    expect(screen.getByText("All supported cosmetics are already unlocked.")).toBeTruthy();
    expect(
      button(
        screen.getByRole("button", {
          name: "Unlock Remaining Cosmetics",
        }),
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Clean")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const malformed = JSON.stringify({
      cosmeticHistory: { value: [] },
      cosmeticUnlocks: { value: [{}] },
      cosmeticPresets: { value: [] },
    });
    const encrypted = await encryptEs3(new TextEncoder().encode(malformed), {
      testIv: new Uint8Array(16),
    });
    const file = new File([encrypted], "MetaSave.es3");
    Object.defineProperty(file, "arrayBuffer", { value: async () => encrypted.buffer });
    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });

    expect(await screen.findByText("Save not loaded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock Remaining Cosmetics" })).toBeNull();
  });

  it("exports and reloads cosmetic ownership without changing unknown IDs or presets", async () => {
    const download = installDownloadMocks();
    const presets = [[27], [], [999]];
    render(<App />);

    fireEvent.change(screen.getByLabelText(/drop a save here/i), {
      target: { files: [await metaFile([27, 999], presets)] },
    });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Unlock Remaining Cosmetics" }));
    fireEvent.click(screen.getByRole("button", { name: "Download verified copy" }));
    await screen.findByText("MetaSave.repoditor.es3 was verified and downloaded.");

    const exported = download.createObjectURL.mock.calls[0]?.[0];
    expect(exported).toBeInstanceOf(Blob);
    if (!(exported instanceof Blob)) {
      throw new Error("Expected the verified export Blob.");
    }
    const reopened = await loadSaveBytes(
      new Uint8Array(await exported.arrayBuffer()),
      "MetaSave.repoditor.es3",
    );
    expect(inspectMetaCosmetics(reopened.data)).toEqual({
      ownedSupportedCount: cosmeticCount,
      remainingSupportedCount: 0,
      totalSupportedCount: cosmeticCount,
    });

    const unlockEntry = reopened.data.cosmeticUnlocks;
    const presetEntry = reopened.data.cosmeticPresets;
    expect(isSaveObject(unlockEntry) && Array.isArray(unlockEntry.value)).toBe(true);
    expect(
      isSaveObject(unlockEntry) &&
        Array.isArray(unlockEntry.value) &&
        unlockEntry.value.some((item) => isSaveNumber(item) && item.value === "999"),
    ).toBe(true);
    expect(
      isSaveObject(presetEntry) ? serializeSaveJson({ cosmeticPresets: presetEntry }) : null,
    ).toBe(
      serializeSaveJson(parseSaveJson(JSON.stringify({ cosmeticPresets: { value: presets } }))),
    );
    expect(reopened.data.unrelated).toEqual({ future: "preserved" });
  });

  it("does not expose export for an invalid file", async () => {
    render(<App />);
    const file = new File(["not an ES3 container"], "invalid.es3");
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("not an ES3 container").buffer,
    });

    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });

    expect(await screen.findByText("Save not loaded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download verified copy" })).toBeNull();
  });

  it("announces download failures accessibly", async () => {
    const download = installDownloadMocks();
    download.createObjectURL.mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<App />);
    const file = await runFile();

    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Download verified copy" }));

    expect(
      await screen.findByText("The encrypted copy could not be prepared safely."),
    ).toBeTruthy();
    expect(download.click).not.toHaveBeenCalled();
    expect(download.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("switches locale in place and preserves the accepted working save", async () => {
    render(<App />);
    const file = await runFile();

    fireEvent.change(screen.getByLabelText(/drop a save here/i), { target: { files: [file] } });
    await screen.findByTestId("save-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Currency" }), {
      target: { value: "13" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    fireEvent.click(screen.getByRole("option", { name: "日本語" }));

    expect(document.documentElement.lang).toBe("ja");
    expect(window.localStorage.getItem("repoditor-locale")).toBe("ja");
    expect(screen.getByRole("heading", { level: 1, name: "REPO_SAVE.es3" })).toBeTruthy();
    expect(input(screen.getByRole("spinbutton", { name: "通貨" })).value).toBe("13");
    expect(screen.getByText("保留中の変更 1 件")).toBeTruthy();
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "言語：日本語" }));
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(input(screen.getByRole("spinbutton", { name: "Currency" })).value).toBe("13");
    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("falls back to English for an unsupported stored locale", () => {
    window.localStorage.setItem("repoditor-locale", "fr");
    render(<App />);

    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "Language: English" })).toBeTruthy();
  });

  it("keeps an open dialog and its selected platform when the locale changes", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Find my save" }));
    fireEvent.click(screen.getByRole("tab", { name: "Linux / Proton" }));

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    fireEvent.click(screen.getByRole("option", { name: "한국어" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "내 세이브 찾기" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Linux / Proton" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("supports wraparound, Home, End, and keyboard locale selection", () => {
    render(<App />);
    const trigger = screen.getByTestId("language-menu-trigger");
    fireEvent.click(trigger);
    const english = screen.getByRole("option", { name: "English" });
    const indonesian = screen.getByRole("option", { name: "Bahasa Indonesia" });
    const chinese = screen.getByRole("option", { name: "简体中文" });

    expect(document.activeElement).toBe(english);
    fireEvent.keyDown(english, { key: "ArrowUp" });
    expect(document.activeElement).toBe(chinese);
    fireEvent.keyDown(chinese, { key: "Home" });
    expect(document.activeElement).toBe(english);
    fireEvent.keyDown(english, { key: "ArrowDown" });
    expect(document.activeElement).toBe(indonesian);
    fireEvent.keyDown(indonesian, { key: "End" });
    expect(document.activeElement).toBe(chinese);
    fireEvent.keyDown(chinese, { key: "Enter" });

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
