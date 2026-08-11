// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createProjectMetadataHandler, getProjectMetadata } = require(
  "../../dist-electron/ipc/project.cjs",
);

function response(body: unknown, ok = true) {
  return { ok, json: vi.fn().mockResolvedValue(body) };
}

describe("project metadata IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns only the validated star count from the fixed repository endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      stargazers_count: 42,
      owner: { login: "private-unneeded-field" },
    }));

    await expect(getProjectMetadata(fetcher)).resolves.toEqual({
      ok: true,
      data: { stars: 42 },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/Yoruxyv/RepoDitor",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("rejects malformed responses", async () => {
    for (const body of [{}, { stargazers_count: -1 }, { stargazers_count: "42" }]) {
      await expect(getProjectMetadata(vi.fn().mockResolvedValue(response(body))))
        .resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
    }
  });

  it("fails softly and caches only successful metadata for the session", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({}, false))
      .mockResolvedValueOnce(response({ stargazers_count: 43 }));
    const handler = createProjectMetadataHandler(fetcher);

    await expect(handler()).resolves.toMatchObject({ ok: false });
    await expect(handler()).resolves.toEqual({ ok: true, data: { stars: 43 } });
    await expect(handler()).resolves.toEqual({ ok: true, data: { stars: 43 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
