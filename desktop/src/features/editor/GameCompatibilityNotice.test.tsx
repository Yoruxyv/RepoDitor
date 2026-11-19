import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderWithPreferences } from "@/test/render";
import { GameCompatibilityNotice, installedWriteRestriction } from "./GameCompatibilityNotice";

it("does not announce a restriction when every editing domain is available", () => {
  renderWithPreferences(<GameCompatibilityNotice build="26732417" issue="unknown" features={[]} />);
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("explains only affected domains and retains the reason after the notice is dismissed", async () => {
  const component = (
    <GameCompatibilityNotice build="26732417" issue="unapproved" features={["nav.items"]} />
  );
  const first = renderWithPreferences(component);
  const explanation = screen.getByRole("complementary", { name: "Game compatibility restriction" });
  expect(explanation.textContent).toContain("Items · R.E.P.O. build 26732417");
  expect(explanation.textContent).not.toContain("Players");
  expect(
    within(explanation).getByRole("link", { name: "Check for updates" }).getAttribute("href"),
  ).toBe("https://github.com/Yoruxyv/RepoDitor/releases");
  fireEvent.click(await within(explanation).findByRole("button", { name: "Dismiss notice" }));
  expect(within(explanation).queryByRole("status")).toBeNull();
  expect(explanation.textContent).toContain("until it is approved");
  first.unmount();
  renderWithPreferences(component);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText(/until it is approved/)).toBeTruthy();
});

it("distinguishes missing data, an unverified build and an incompatible saved structure", () => {
  expect(installedWriteRestriction({ gameDetected: false })).toBe("missing");
  expect(installedWriteRestriction({ gameDetected: true })).toBe("unknown");
  expect(
    installedWriteRestriction({
      gameDetected: true,
      healthWriteCompatibility: { buildId: "26732417", status: "unsupported", supported: false },
    }),
  ).toBe("unapproved");
  renderWithPreferences(
    <GameCompatibilityNotice issue="incompatible" features={["app.cosmetics"]} />,
  );
  expect(screen.getByText(/assets or save structure could not be read safely/)).toBeTruthy();
});
