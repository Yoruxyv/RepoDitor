import { classifySave, type SaveKind } from "@/features/save-file/processing/classification";
import type { LoadedSave } from "@/features/save-file/processing/pipeline";
import {
  parseSaveJson,
  serializeSaveJson,
  type SaveObject,
} from "@/features/save-file/processing/serialization";

export interface EditSession {
  readonly baselineSource: string;
  readonly originalFileName: string;
  readonly originalKind: SaveKind;
  readonly sessionToken: symbol;
  readonly working: SaveObject;
}

export class EditSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditSessionError";
  }
}

function reconstruct(source: string, kind: SaveKind): SaveObject {
  const data = parseSaveJson(source);
  if (classifySave(data) !== kind) {
    throw new EditSessionError("The working save no longer matches its original save type.");
  }
  return data;
}

export function createEditSession(save: LoadedSave): EditSession {
  const baselineSource = serializeSaveJson(save.data);
  return {
    baselineSource,
    originalFileName: save.fileName,
    originalKind: save.kind,
    sessionToken: Symbol("edit-session"),
    working: reconstruct(baselineSource, save.kind),
  };
}

export function hasPendingChanges(session: EditSession): boolean {
  const workingSource = serializeSaveJson(session.working);
  reconstruct(workingSource, session.originalKind);
  return workingSource !== session.baselineSource;
}

export function resetEditSession(session: EditSession): EditSession {
  return {
    ...session,
    working: reconstruct(session.baselineSource, session.originalKind),
  };
}
