import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonRegion } from "./Skeleton";

describe("Skeleton", () => {
  it("keeps visual shapes decorative and disables motion for reduced-motion users", () => {
    render(
      <SkeletonRegion label="Loading content" testId="loading-region">
        <Skeleton className="h-4 w-20" testId="shape" />
      </SkeletonRegion>,
    );

    expect(screen.getByTestId("loading-region").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("loading-region").tagName).toBe("OUTPUT");
    expect(screen.getByTestId("loading-region").className).toContain("motion-reduce:animate-none");
    expect(screen.getByTestId("shape").getAttribute("aria-hidden")).toBe("true");
  });
});
