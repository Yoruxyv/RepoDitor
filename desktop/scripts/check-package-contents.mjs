import { access } from "node:fs/promises";

const requiredFiles = [
  "RepoDitor.exe",
  "resources/app.asar",
  "resources/backend/repoditor-backend.exe",
  "resources/licenses/RepoDitor-MIT.txt",
  "resources/licenses/Teko-OFL.txt",
];

for (const file of requiredFiles) {
  await access(new URL(`../release/win-unpacked/${file}`, import.meta.url));
}

console.log(`Packaged application contains all ${requiredFiles.length} required files.`);
