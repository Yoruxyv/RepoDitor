import { ipcMain, net } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import type { DesktopOperationResult, ProjectMetadata } from "../contracts.cjs";

const PROJECT_API_URL = "https://api.github.com/repos/Yoruxyv/RepoDitor";

interface ProjectResponse {
  readonly ok: boolean;
  json: () => Promise<unknown>;
}

type ProjectFetcher = (
  url: string,
  options: { readonly headers: Record<string, string> },
) => Promise<ProjectResponse>;

class ProjectProtocolError extends Error {}

function readMetadata(value: unknown): ProjectMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectProtocolError();
  }
  const stars = (value as Record<string, unknown>).stargazers_count;
  if (typeof stars !== "number" || !Number.isSafeInteger(stars) || stars < 0) {
    throw new ProjectProtocolError();
  }
  return { stars };
}

/**
 * Fetch and validate only the fixed RepoDitor repository metadata contract.
 *
 * @param fetcher - Electron network adapter or isolated test double.
 * @returns A narrow star-count result or stable renderer-safe failure.
 */
export async function getProjectMetadata(
  fetcher: ProjectFetcher,
): Promise<DesktopOperationResult<ProjectMetadata>> {
  try {
    const response = await fetcher(PROJECT_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: { code: "backend_unavailable", message: "GitHub metadata is unavailable." },
      };
    }
    return { ok: true, data: readMetadata(await response.json()) };
  } catch (error) {
    console.error("Project metadata operation failed.", error);
    return error instanceof ProjectProtocolError
      ? {
          ok: false,
          error: {
            code: "invalid_response",
            message: "GitHub metadata did not match the desktop contract.",
          },
        }
      : {
          ok: false,
          error: { code: "backend_unavailable", message: "GitHub metadata is unavailable." },
        };
  }
}

/**
 * Create the session-scoped metadata handler used by Electron IPC.
 *
 * Successful results are cached for the Electron session; failures may retry.
 *
 * @param fetcher - Fixed-endpoint repository metadata loader.
 * @returns A zero-argument IPC handler with a successful-result cache.
 */
export function createProjectMetadataHandler(fetcher: ProjectFetcher) {
  let cached: DesktopOperationResult<ProjectMetadata> | null = null;
  return async (): Promise<DesktopOperationResult<ProjectMetadata>> => {
    if (cached?.ok) {
      return cached;
    }
    cached = await getProjectMetadata(fetcher);
    return cached;
  };
}

/**
 * Register the single fixed GitHub metadata IPC channel.
 *
 * @param fetcher - Optional test double; production uses Electron `net.fetch`.
 */
export function registerProjectIpc(
  fetcher?: ProjectFetcher,
): void {
  const request = fetcher ?? ((url, options) => net.fetch(url, options));
  ipcMain.handle(IPC_CHANNELS.projectMetadata, createProjectMetadataHandler(request));
}
