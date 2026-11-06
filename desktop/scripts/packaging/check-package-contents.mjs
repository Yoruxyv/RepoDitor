/** Fail-closed smoke check for files required in the unpacked Windows application. */
import { access } from "node:fs/promises";

const requiredFiles = [
  "RepoDitor.exe",
  "resources/app.asar",
  "resources/backend/repoditor-backend.exe",
  "resources/backend/_internal/TypeTreeGeneratorAPI/TypeTreeGeneratorAPI.dll",
  "resources/backend/_internal/UnityPy/resources/lzma.tpk",
  "resources/backend/_internal/fmod_toolkit/libfmod/Windows/x64/fmod.dll",
  "resources/backend/_internal/archspec/json/cpu/cpuid.json",
  "resources/backend/_internal/archspec/json/cpu/microarchitectures.json",
  "resources/licenses/RepoDitor-MIT.txt",
  "resources/licenses/Teko-OFL.txt",
];

for (const file of requiredFiles) {
  await access(new URL(`../../release/win-unpacked/${file}`, import.meta.url));
}

console.log(`Packaged application contains all ${requiredFiles.length} required files.`);
