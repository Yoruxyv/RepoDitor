import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const srcRoot = path.join(desktopRoot, "src");
const electronRoot = path.join(desktopRoot, "electron");
const tsconfigPath = path.join(desktopRoot, "tsconfig.app.json");

const flags = new Set(process.argv.slice(2));
const shouldWrite = flags.has("--write");
const shouldCheck = flags.has("--check");
const strict = flags.has("--strict");
const verbose = flags.has("--verbose") || !shouldWrite;

if (flags.has("--help")) {
  console.log(`Usage:
  node scripts/normalize-imports.mjs             Preview changes
  node scripts/normalize-imports.mjs --write     Apply changes
  node scripts/normalize-imports.mjs --check     Exit 1 when changes are needed
  node scripts/normalize-imports.mjs --strict    Fail on unresolved local imports
  node scripts/normalize-imports.mjs --verbose   Print every replacement
`);
  process.exit(0);
}

if (shouldWrite && shouldCheck) {
  console.error("Choose either --write or --check, not both.");
  process.exit(2);
}

const allowedFlags = new Set(["--write", "--check", "--strict", "--verbose", "--help"]);

const unknownFlags = [...flags].filter((flag) => !allowedFlags.has(flag));

if (unknownFlags.length > 0) {
  console.error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  process.exit(2);
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => desktopRoot,
    getNewLine: () => "\n",
  });
}

const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

if (configFile.error !== undefined) {
  console.error(formatDiagnostics([configFile.error]));
  process.exit(2);
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  desktopRoot,
  undefined,
  tsconfigPath,
);

if (parsedConfig.errors.length > 0) {
  console.error(formatDiagnostics(parsedConfig.errors));
  process.exit(2);
}

const compilerOptions = parsedConfig.options;
const ignoredDirectoryNames = new Set([
  ".git",
  ".vite-cache",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function isTypeScriptSource(filePath) {
  return /\.(?:ts|tsx|mts|cts)$/i.test(filePath);
}

function collectFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  const files = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();

    if (currentDirectory === undefined) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
        continue;
      }

      if (entry.isFile() && isTypeScriptSource(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function isInside(parentDirectory, candidatePath) {
  const relativePath = path.relative(parentDirectory, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function splitSpecifierSuffix(specifier) {
  const suffixIndex = specifier.search(/[?#]/u);

  if (suffixIndex === -1) {
    return { base: specifier, suffix: "" };
  }

  return {
    base: specifier.slice(0, suffixIndex),
    suffix: specifier.slice(suffixIndex),
  };
}

function resolveCandidate(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return path.resolve(basePath);
  }

  const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

  for (const extension of extensions) {
    const fileCandidate = `${basePath}${extension}`;

    if (fs.existsSync(fileCandidate) && fs.statSync(fileCandidate).isFile()) {
      return path.resolve(fileCandidate);
    }
  }

  for (const extension of extensions) {
    const indexCandidate = path.join(basePath, `index${extension}`);

    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return path.resolve(indexCandidate);
    }
  }

  return null;
}

function resolveModulePath(specifier, containingFile) {
  const resolvedByTypeScript = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName;

  if (resolvedByTypeScript !== undefined) {
    return path.resolve(resolvedByTypeScript);
  }

  if (specifier.startsWith("@/")) {
    return resolveCandidate(path.join(srcRoot, specifier.slice(2)));
  }

  if (specifier.startsWith("@electron/")) {
    return resolveCandidate(path.join(electronRoot, specifier.slice(10)));
  }

  if (specifier.startsWith(".")) {
    return resolveCandidate(path.resolve(path.dirname(containingFile), specifier));
  }

  return null;
}

function moduleStem(resolvedFilePath) {
  let stem = resolvedFilePath
    .replace(/\.d\.(?:ts|mts|cts)$/iu, "")
    .replace(/\.[cm]?[jt]sx?$/iu, "");

  if (path.basename(stem).toLowerCase() === "index") {
    stem = path.dirname(stem);
  }

  return stem;
}

function architectureOwner(filePath) {
  if (!isInside(srcRoot, filePath)) {
    return null;
  }

  const parts = toPosix(path.relative(srcRoot, filePath)).split("/");

  if (parts[0] === "features" && parts[1] !== undefined) {
    return `feature:${parts[1]}`;
  }

  if (parts[0] === "app" || parts[0] === "shared") {
    return parts[0];
  }

  return "root";
}

function buildAliasSpecifier(resolvedFilePath) {
  const relativePath = toPosix(path.relative(srcRoot, moduleStem(resolvedFilePath)));

  return `@/${relativePath}`;
}

function buildElectronAliasSpecifier(resolvedFilePath) {
  const relativePath = toPosix(path.relative(electronRoot, moduleStem(resolvedFilePath)));

  return `@electron/${relativePath}`;
}

function buildRelativeSpecifier(containingFile, resolvedFilePath) {
  let relativePath = toPosix(
    path.relative(path.dirname(containingFile), moduleStem(resolvedFilePath)),
  );

  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
}

function leadingParentCount(specifier) {
  let count = 0;

  for (const segment of specifier.split("/")) {
    if (segment !== "..") {
      break;
    }
    count += 1;
  }

  return count;
}

function preferredSpecifier(containingFile, resolvedFilePath) {
  if (!isInside(srcRoot, containingFile)) {
    return null;
  }

  // Renderer access to the shared Electron contract boundary never uses deep
  // relative traversal. Electron's own imports remain outside this scan.
  if (isInside(electronRoot, resolvedFilePath)) {
    return buildElectronAliasSpecifier(resolvedFilePath);
  }

  if (!isInside(srcRoot, resolvedFilePath)) {
    return null;
  }

  const aliasSpecifier = buildAliasSpecifier(resolvedFilePath);
  const relativeSpecifier = buildRelativeSpecifier(containingFile, resolvedFilePath);
  const sourceOwner = architectureOwner(containingFile);
  const targetOwner = architectureOwner(resolvedFilePath);
  const crossesArchitectureBoundary =
    sourceOwner !== null && targetOwner !== null && sourceOwner !== targetOwner;
  const leavesCurrentDirectory = leadingParentCount(relativeSpecifier) >= 1;

  // Same-folder imports stay relative; every parent traversal uses @/.
  return crossesArchitectureBoundary || leavesCurrentDirectory ? aliasSpecifier : relativeSpecifier;
}

function isStringModuleSpecifier(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function collectModuleSpecifierNodes(sourceFile) {
  const nodes = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) && isStringModuleSpecifier(node.moduleSpecifier)) {
      nodes.push(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringModuleSpecifier(node.moduleSpecifier)
    ) {
      nodes.push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;

      if (argument !== undefined && isDynamicImport && isStringModuleSpecifier(argument)) {
        nodes.push(argument);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return nodes;
}

function scriptKindFor(filePath) {
  if (/\.tsx$/iu.test(filePath)) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

const files = collectFiles(srcRoot);

let changedFileCount = 0;
let replacementCount = 0;
let unresolvedCount = 0;

for (const filePath of files) {
  const originalText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    originalText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const replacements = [];

  for (const moduleNode of collectModuleSpecifierNodes(sourceFile)) {
    const originalSpecifier = moduleNode.text;

    if (
      !originalSpecifier.startsWith(".") &&
      !originalSpecifier.startsWith("@/") &&
      !originalSpecifier.startsWith("@electron/")
    ) {
      continue;
    }

    // Alias normalization is monotonic: a valid renderer alias stays an alias.
    if (originalSpecifier.startsWith("@/") || originalSpecifier.startsWith("@electron/")) {
      continue;
    }

    const { base, suffix } = splitSpecifierSuffix(originalSpecifier);
    const resolvedFilePath = resolveModulePath(base, filePath);

    if (resolvedFilePath === null) {
      unresolvedCount += 1;
      console.warn(
        `[unresolved] ${toPosix(path.relative(desktopRoot, filePath))}: ${originalSpecifier}`,
      );
      continue;
    }

    const preferredBase = preferredSpecifier(filePath, resolvedFilePath);

    if (preferredBase === null) {
      continue;
    }

    const nextSpecifier = `${preferredBase}${suffix}`;

    if (nextSpecifier === originalSpecifier) {
      continue;
    }

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      moduleNode.getStart(sourceFile),
    );

    replacements.push({
      start: moduleNode.getStart(sourceFile) + 1,
      end: moduleNode.getEnd() - 1,
      text: nextSpecifier,
      line: line + 1,
      column: character + 1,
      from: originalSpecifier,
      to: nextSpecifier,
    });
  }

  if (replacements.length === 0) {
    continue;
  }

  changedFileCount += 1;
  replacementCount += replacements.length;

  if (verbose) {
    console.log(`\n${toPosix(path.relative(desktopRoot, filePath))}`);
    for (const replacement of replacements) {
      console.log(
        `  ${replacement.line}:${replacement.column}  ${replacement.from} -> ${replacement.to}`,
      );
    }
  }

  let updatedText = originalText;

  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    updatedText =
      updatedText.slice(0, replacement.start) +
      replacement.text +
      updatedText.slice(replacement.end);
  }

  if (shouldWrite) {
    fs.writeFileSync(filePath, updatedText, "utf8");
  }
}

const mode = shouldWrite ? "updated" : shouldCheck ? "check" : "preview";

console.log(`\nImport normalization ${mode} complete.`);
console.log(`Files scanned   : ${files.length}`);
console.log(`Files affected  : ${changedFileCount}`);
console.log(`Imports changed : ${replacementCount}`);
console.log(`Unresolved      : ${unresolvedCount}`);

if (strict && unresolvedCount > 0) {
  process.exit(2);
}

if (shouldCheck && replacementCount > 0) {
  process.exit(1);
}
