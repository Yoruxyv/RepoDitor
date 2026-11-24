import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { handleSteamAvatarRequest, MAX_AVATAR_REQUEST_BYTES } from "./api/steam-avatars.ts";
import { capabilitySignature } from "./scripts/capability-signature.ts";

function webHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function localBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > MAX_AVATAR_REQUEST_BYTES) {
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function serveAvatarEndpoint(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/steam-avatars") {
    return false;
  }
  const body = await localBody(request);
  const method = request.method ?? "GET";
  const requestInit: RequestInit = { headers: webHeaders(request.headers), method };
  if (method !== "GET" && method !== "HEAD" && body !== null) {
    requestInit.body = body.toString("utf8");
  }
  const result =
    body === null
      ? Response.json({ error: "Invalid avatar request." }, { status: 400 })
      : await handleSteamAvatarRequest(
          new Request("http://localhost/api/steam-avatars", requestInit),
        );
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await result.arrayBuffer()));
  return true;
}

function localAvatarEndpoint(): Plugin {
  const middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): void => {
    void serveAvatarEndpoint(request, response)
      .then((handled) => {
        if (!handled) {
          next();
        }
      })
      .catch(next);
  };
  return {
    name: "repoditor-local-avatar-endpoint",
    configurePreviewServer: ({ middlewares }) => {
      middlewares.use(middleware);
    },
    configureServer: ({ middlewares }) => {
      middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  build: { sourcemap: false },
  cacheDir: ".vite-cache",
  plugins: [
    react(),
    tailwindcss(),
    localAvatarEndpoint(),
    {
      name: "repoditor-capability-signature",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "repoditor-capabilities", content: capabilitySignature } },
      ],
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["api/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
