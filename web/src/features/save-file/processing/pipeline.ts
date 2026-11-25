import { decryptEs3, encryptEs3, Es3CryptoError } from "@/features/save-file/processing/es3";
import { classifySave, type SaveKind } from "@/features/save-file/processing/classification";
import {
  parseSaveJson,
  SaveSerializationError,
  serializeSaveJson,
  type SaveObject,
} from "@/features/save-file/processing/serialization";

const SAVE_PIPELINE_ERROR_CODE = {
  decryptFailed: "decrypt-failed",
  malformedSave: "malformed-save",
  unsupportedFile: "unsupported-file",
  unsupportedSave: "unsupported-save",
} as const;

type SavePipelineErrorCode =
  (typeof SAVE_PIPELINE_ERROR_CODE)[keyof typeof SAVE_PIPELINE_ERROR_CODE];

const SAVE_PIPELINE_MESSAGE = {
  fileTooLarge: "This save is larger than the 16 MiB browser safety limit.",
} as const;

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
export const MAX_SAVE_FILE_BYTES = 16 * 1024 * 1024;

export { classifySave } from "@/features/save-file/processing/classification";
export type { SaveClassification, SaveKind } from "@/features/save-file/processing/classification";

export interface LoadedSave {
  readonly data: SaveObject;
  readonly fileName: string;
  readonly kind: SaveKind;
}

export class SavePipelineError extends Error {
  readonly code: SavePipelineErrorCode;

  constructor(code: SavePipelineErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SavePipelineError";
  }
}

export interface LocalSaveFile {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function loadSaveBytes(bytes: Uint8Array, fileName: string): Promise<LoadedSave> {
  if (bytes.byteLength > MAX_SAVE_FILE_BYTES) {
    throw new SavePipelineError(
      SAVE_PIPELINE_ERROR_CODE.unsupportedFile,
      SAVE_PIPELINE_MESSAGE.fileTooLarge,
    );
  }
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptEs3(bytes);
  } catch (error) {
    if (error instanceof Es3CryptoError && error.code === "invalid-container") {
      throw new SavePipelineError(SAVE_PIPELINE_ERROR_CODE.unsupportedFile, error.message);
    }
    throw new SavePipelineError(
      SAVE_PIPELINE_ERROR_CODE.decryptFailed,
      "This save could not be decrypted. It may be corrupted or unsupported.",
    );
  }

  let data: SaveObject;
  try {
    data = parseSaveJson(decoder.decode(plaintext));
  } catch (error) {
    if (error instanceof SaveSerializationError) {
      throw new SavePipelineError(SAVE_PIPELINE_ERROR_CODE.malformedSave, error.message);
    }
    if (error instanceof TypeError) {
      throw new SavePipelineError(
        SAVE_PIPELINE_ERROR_CODE.malformedSave,
        "The file decrypted, but its save structure is malformed.",
      );
    }
    throw error;
  }

  const kind = classifySave(data);
  if (kind === "unsupported") {
    throw new SavePipelineError(
      SAVE_PIPELINE_ERROR_CODE.unsupportedSave,
      "This is valid save data, but its save type is not supported yet.",
    );
  }

  return { data, fileName, kind };
}

export async function loadSaveFile(file: LocalSaveFile): Promise<LoadedSave> {
  if (!file.name.toLowerCase().endsWith(".es3")) {
    throw new SavePipelineError(
      SAVE_PIPELINE_ERROR_CODE.unsupportedFile,
      "Choose a R.E.P.O. .es3 save file.",
    );
  }
  if (file.size !== undefined && file.size > MAX_SAVE_FILE_BYTES) {
    throw new SavePipelineError(
      SAVE_PIPELINE_ERROR_CODE.unsupportedFile,
      SAVE_PIPELINE_MESSAGE.fileTooLarge,
    );
  }
  return loadSaveBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

export async function reencryptSave(save: LoadedSave): Promise<Uint8Array<ArrayBuffer>> {
  return encryptEs3(encoder.encode(serializeSaveJson(save.data)));
}
