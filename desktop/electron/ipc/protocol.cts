/**
 * Shared runtime validation and stable failure mapping for editor IPC handlers.
 *
 * Domain handlers retain responsibility for their DTO shapes. Errors are bounded
 * and sanitized before returning to the renderer.
 */
import {
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
} from "../contracts.cjs";
import { PythonClientError } from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const EDITOR_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "save_missing",
  "save_corrupt",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
]);

export class EditorProtocolError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

export function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

export function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

export function readNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : readInteger(value, field);
}

export function parseError(value: unknown): DesktopOperationFailure {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    throw new EditorProtocolError("Invalid editor response.");
  }
  const code = readString(value.error.code, "error code");
  if (!EDITOR_ERROR_CODES.has(code as DesktopOperationErrorCode)) {
    throw new EditorProtocolError("Invalid editor error code.");
  }
  return {
    ok: false,
    error: {
      code: code as DesktopOperationErrorCode,
      message: readString(value.error.message, "error message"),
    },
  };
}

function publicError(domain: string, error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: `The Python ${domain} service is unavailable.`,
      process_failed: `The Python ${domain} service failed.`,
      process_timeout: `The Python ${domain} service timed out.`,
      empty_response: `The Python ${domain} service returned no data.`,
      malformed_response: `The Python ${domain} service returned malformed data.`,
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof EditorProtocolError) {
    return {
      code: "invalid_response",
      message: `The Python ${domain} response did not match the desktop contract.`,
    };
  }
  return { code: "internal_error", message: `The desktop ${domain} bridge failed unexpectedly.` };
}

export function failure(domain: string, error: unknown): DesktopOperationFailure {
  console.error(`${domain} request failed.`, error);
  return { ok: false, error: publicError(domain, error) };
}

export function validSaveId(saveId: unknown): saveId is string {
  return typeof saveId === "string" && SAVE_ID_PATTERN.test(saveId);
}

export function invalidSaveId(): DesktopOperationFailure {
  return {
    ok: false,
    error: { code: "invalid_request", message: "A valid discovered save ID is required." },
  };
}
