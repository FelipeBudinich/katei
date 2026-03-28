#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  HTML_REPORT_RELATIVE,
  defaultJsonOutputForApp,
  defaultHtmlOutputForApp,
  renderEnvInventoryHtml,
} from "./render-env-inventory-html.mjs";

export const ENV_INVENTORY_SCHEMA_VERSION = "1.0";
export const REPORT_RELATIVE = path.join("docs", "env-inventory.json");
export const DEFAULT_CONFIG_RELATIVE = path.join(".agents", "env-inventory.config.json");
const LEGACY_REPORT_RELATIVE = path.join("doc", "env-inventory.json");

const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"];
const PACKAGE_JSON = "package.json";
const DEFAULT_CONFIG = Object.freeze({
  ignoreGlobs: [
    "**/node_modules/**",
    "**/doc/*.json",
    "**/docs/env-inventory.json",
    "**/.generated/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/src/public/**",
    "**/public/**",
  ],
  extraScanRoots: [],
  sharedRoots: ["packages/*", "libs/*"],
  docRoots: ["README*", "doc/**/*"],
  publicPrefixes: ["NEXT_PUBLIC_", "VITE_", "PUBLIC_"],
  secretLikePatterns: ["KEY", "SECRET", "TOKEN", "PASSWORD", "PWD", "PRIVATE", "DATABASE_URL"],
  appPathOverrides: {},
});
const ROOT_CONTEXT_CANDIDATES = [
  ".github/workflows",
  "k8s",
  "helm",
  "infra",
  "terraform",
];
const ROOT_FILE_PATTERNS = [/^\.env/i, /^Dockerfile/i, /^docker-compose.*\.(yml|yaml)$/i];
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const YAML_EXTENSIONS = new Set([".yml", ".yaml"]);
const CI_BUILTIN_VARIABLES = new Set([
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_SHA",
  "GITHUB_STATE",
]);

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizePath(value) {
  return toPosixPath(path.normalize(String(value || "")));
}

function compareStrings(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob) {
  const normalized = normalizePath(glob);
  let pattern = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += ".";
      continue;
    }
    pattern += escapeRegExp(char);
  }
  pattern += "$";
  return new RegExp(pattern);
}

function matchesGlob(value, pattern) {
  if (!pattern) {
    return false;
  }
  if (pattern === "*") {
    return true;
  }
  return globToRegExp(pattern).test(normalizePath(value));
}

function sortUnique(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).sort(compareStrings);
}

function stripCommentsPreservingLength(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (char === "'" || char === "\"" || char === "`") {
        state = char;
        output += char;
        continue;
      }
      if (char === "/" && next === "/") {
        state = "line-comment";
        output += "  ";
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block-comment";
        output += "  ";
        index += 1;
        continue;
      }
      output += char;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        output += "  ";
        index += 1;
      } else if (char === "\n") {
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }

    if (char === "\\") {
      output += char;
      if (index + 1 < source.length) {
        output += source[index + 1];
        index += 1;
      }
      continue;
    }

    output += char;
    if (char === state) {
      state = "code";
    }
  }
  return output;
}

function buildLineIndex(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineColumnForIndex(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= index && (middle === lineStarts.length - 1 || lineStarts[middle + 1] > index)) {
      return {
        line: middle + 1,
        column: index - lineStarts[middle] + 1,
      };
    }
    if (lineStarts[middle] > index) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return { line: 1, column: index + 1 };
}

function readJsonc(raw, filePath) {
  try {
    return JSON.parse(stripCommentsPreservingLength(raw));
  } catch (error) {
    throw new Error(`Unable to parse JSON from ${filePath}: ${error.message}`);
  }
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return readJsonc(raw, filePath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.includes(path.extname(filePath));
}

function isIgnoredDirectory(relativePath, config) {
  const normalized = normalizePath(relativePath);
  if (normalized.includes("/node_modules/")
    || normalized.includes("/dist/")
    || normalized.includes("/build/")
    || normalized.includes("/coverage/")
    || normalized.includes("/.generated/")
    || normalized.includes("/src/public/")
    || normalized.includes("/public/")) {
    return true;
  }
  return ensureArray(config.ignoreGlobs).some((pattern) => matchesGlob(normalized, pattern));
}

async function walkDirectory(directoryPath, callback, config, repoRoot) {
  if (!(await pathExists(directoryPath))) {
    return;
  }
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directoryPath, entry.name);
    const relative = normalizePath(path.relative(repoRoot, absolute));
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(relative, config)) {
        continue;
      }
      await walkDirectory(absolute, callback, config, repoRoot);
      continue;
    }
    await callback(absolute, relative);
  }
}

async function expandWorkspacePattern(repoRoot, pattern) {
  const normalized = normalizePath(pattern);
  if (!normalized.includes("*")) {
    const candidate = path.join(repoRoot, normalized);
    return (await pathExists(candidate)) ? [candidate] : [];
  }
  const segments = normalized.split("/");
  const starIndex = segments.findIndex((segment) => segment === "*");
  if (starIndex < 0) {
    const candidate = path.join(repoRoot, normalized);
    return (await pathExists(candidate)) ? [candidate] : [];
  }
  const parent = path.join(repoRoot, ...segments.slice(0, starIndex));
  if (!(await pathExists(parent))) {
    return [];
  }
  const entries = await fs.readdir(parent, { withFileTypes: true });
  const suffix = segments.slice(starIndex + 1);
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(parent, entry.name, ...suffix);
    if (await pathExists(candidate)) {
      results.push(candidate);
    }
  }
  return results.sort(compareStrings);
}

export async function discoverApps(repoRoot, appsRootRelative = "apps") {
  const appsRoot = path.resolve(repoRoot, appsRootRelative);
  const entries = await fs.readdir(appsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      rootPath: path.join(appsRoot, entry.name),
      rootRel: normalizePath(path.relative(repoRoot, path.join(appsRoot, entry.name))),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function discoverWorkspaceProjects(repoRoot, apps) {
  const rootPackagePath = path.join(repoRoot, PACKAGE_JSON);
  const rootPackage = await readJsonFile(rootPackagePath);
  const workspacePatterns = ensureArray(rootPackage.workspaces);
  const appRoots = new Set(apps.map((app) => app.rootRel));
  const candidates = new Map();

  for (const pattern of workspacePatterns) {
    const matches = await expandWorkspacePattern(repoRoot, pattern);
    for (const match of matches) {
      candidates.set(normalizePath(path.relative(repoRoot, match)), match);
    }
  }

  const projects = [];
  for (const [rootRel, absoluteRoot] of Array.from(candidates.entries()).sort((left, right) => left[0].localeCompare(right[0]))) {
    const packagePath = path.join(absoluteRoot, PACKAGE_JSON);
    if (!(await pathExists(packagePath))) {
      continue;
    }
    const packageJson = await readJsonFile(packagePath);
    projects.push({
      rootPath: absoluteRoot,
      rootRel,
      srcRootPath: path.join(absoluteRoot, "src"),
      srcRootRel: normalizePath(path.join(rootRel, "src")),
      projectName: String(packageJson.name || path.basename(absoluteRoot)),
      ownerName: rootRel.startsWith("apps/") ? path.basename(absoluteRoot) : String(packageJson.name || path.basename(absoluteRoot)),
      ownerType: rootRel.startsWith("apps/") ? "app" : "package",
      packageJson,
      isApp: appRoots.has(rootRel),
    });
  }
  return projects.sort((left, right) => left.rootRel.localeCompare(right.rootRel));
}

function wildcardCapture(pattern, candidate) {
  if (!pattern.includes("*")) {
    return pattern === candidate ? [""] : null;
  }
  const parts = pattern.split("*").map(escapeRegExp);
  const regex = new RegExp(`^${parts.join("(.*)")}$`);
  const match = candidate.match(regex);
  if (!match) {
    return null;
  }
  return match.slice(1);
}

function applyWildcard(template, captures) {
  let captureIndex = 0;
  return template.replace(/\*/g, () => captures[captureIndex++] || "");
}

async function loadNearestConfig(repoRoot, absoluteFilePath, configCache) {
  let current = path.dirname(absoluteFilePath);
  const repoReal = path.resolve(repoRoot);
  while (normalizePath(current).startsWith(normalizePath(repoReal))) {
    if (configCache.has(current)) {
      return configCache.get(current);
    }
    for (const fileName of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = path.join(current, fileName);
      if (existsSync(candidate)) {
        const raw = await fs.readFile(candidate, "utf8");
        const parsed = readJsonc(raw, candidate);
        const compilerOptions = isObject(parsed.compilerOptions) ? parsed.compilerOptions : {};
        const config = {
          filePath: candidate,
          directory: current,
          baseUrl: typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : "",
          paths: isObject(compilerOptions.paths) ? compilerOptions.paths : {},
        };
        configCache.set(current, config);
        return config;
      }
    }
    configCache.set(current, null);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

async function resolvePathLike(repoRoot, baseDirectory, request) {
  const candidateBase = path.resolve(baseDirectory, request);
  const candidates = [
    candidateBase,
    ...SOURCE_EXTENSIONS.map((extension) => `${candidateBase}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(candidateBase, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return normalizePath(path.relative(repoRoot, candidate));
    }
  }
  return null;
}

async function resolveAliasImport(repoRoot, specifier, sourceFilePath, configCache) {
  const config = await loadNearestConfig(repoRoot, sourceFilePath, configCache);
  if (!config) {
    return null;
  }
  const baseDirectory = config.baseUrl ? path.resolve(config.directory, config.baseUrl) : config.directory;

  for (const [pattern, values] of Object.entries(config.paths)) {
    const captures = wildcardCapture(pattern, specifier);
    if (!captures) {
      continue;
    }
    for (const value of ensureArray(values)) {
      const request = applyWildcard(String(value || ""), captures);
      const resolved = await resolvePathLike(repoRoot, baseDirectory, request);
      if (resolved) {
        return {
          resolvedTarget: resolved,
          configFile: normalizePath(path.relative(repoRoot, config.filePath)),
        };
      }
    }
  }

  if (config.baseUrl) {
    const resolved = await resolvePathLike(repoRoot, baseDirectory, specifier);
    if (resolved) {
      return {
        resolvedTarget: resolved,
        configFile: normalizePath(path.relative(repoRoot, config.filePath)),
      };
    }
  }

  return null;
}

function normalizeExports(exportsField) {
  if (typeof exportsField === "string") {
    return new Map([[".", exportsField]]);
  }
  if (!isObject(exportsField)) {
    return new Map();
  }
  const result = new Map();
  for (const [key, value] of Object.entries(exportsField)) {
    if (typeof value === "string") {
      result.set(key, value);
      continue;
    }
    if (isObject(value)) {
      for (const conditionValue of Object.values(value)) {
        if (typeof conditionValue === "string") {
          result.set(key, conditionValue);
          break;
        }
      }
    }
  }
  return result;
}

function resolveExportTarget(packageRoot, mapping, subpath) {
  const exportsMap = normalizeExports(mapping);
  if (!exportsMap.size) {
    return null;
  }
  if (exportsMap.has(subpath)) {
    return path.resolve(packageRoot, exportsMap.get(subpath));
  }
  for (const [key, value] of exportsMap.entries()) {
    if (!key.includes("*")) {
      continue;
    }
    const captures = wildcardCapture(key, subpath);
    if (!captures) {
      continue;
    }
    return path.resolve(packageRoot, applyWildcard(value, captures));
  }
  return null;
}

async function resolveWorkspaceImport(repoRoot, specifier, workspaceProjects) {
  const sortedProjects = [...workspaceProjects].sort((left, right) => right.projectName.length - left.projectName.length);
  for (const project of sortedProjects) {
    if (specifier !== project.projectName && !specifier.startsWith(`${project.projectName}/`)) {
      continue;
    }
    const subpath = specifier === project.projectName ? "." : `./${specifier.slice(project.projectName.length + 1)}`;
    const exportTarget = resolveExportTarget(project.rootPath, project.packageJson.exports, subpath);
    if (exportTarget && existsSync(exportTarget)) {
      return {
        resolvedTarget: normalizePath(path.relative(repoRoot, exportTarget)),
        project,
      };
    }
    if (subpath === "." && typeof project.packageJson.main === "string") {
      const mainTarget = path.resolve(project.rootPath, project.packageJson.main);
      if (existsSync(mainTarget)) {
        return {
          resolvedTarget: normalizePath(path.relative(repoRoot, mainTarget)),
          project,
        };
      }
    }
    if (subpath === ".") {
      const srcIndex = await resolvePathLike(repoRoot, project.rootPath, "src/index");
      return {
        resolvedTarget: srcIndex || project.rootRel,
        project,
      };
    }
    return {
      resolvedTarget: null,
      project,
    };
  }
  return null;
}

export function extractImports(source, filePath = "") {
  const sanitized = stripCommentsPreservingLength(source);
  const lineStarts = buildLineIndex(sanitized);
  const matches = [];
  const seen = new Set();
  const patterns = [
    { kind: "import", regex: /\bimport\s+type\s+[\w*\s{},]+\s+from\s+(['"])([^'"]+)\1/g },
    { kind: "import", regex: /\bimport\s+(?!\()([\w*\s{},]+)\s+from\s+(['"])([^'"]+)\2/g },
    { kind: "import", regex: /\bimport\s+(['"])([^'"]+)\1/g },
    { kind: "export", regex: /\bexport\s+[\w*\s{},]+\s+from\s+(['"])([^'"]+)\1/g },
    { kind: "require", regex: /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
    { kind: "dynamic-import", regex: /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(sanitized)) !== null) {
      const specifier = String(match[match.length - 1] || "");
      if (!specifier) {
        continue;
      }
      const specifierOffset = match[0].indexOf(specifier);
      const location = lineColumnForIndex(lineStarts, match.index + Math.max(specifierOffset, 0));
      const key = `${pattern.kind}:${match.index}:${specifier}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      matches.push({
        kind: pattern.kind,
        specifier,
        line: location.line,
        column: location.column,
        file: normalizePath(filePath),
      });
    }
  }

  return matches.sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.specifier.localeCompare(right.specifier);
  });
}

export async function resolveImport({
  repoRoot,
  sourceFile,
  specifier,
  workspaceProjects,
  configCache,
}) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolvedTarget = await resolvePathLike(repoRoot, path.dirname(sourceFile.absolutePath), specifier);
    return resolvedTarget ? {
      kind: "internal",
      resolvedTarget,
      targetProject: workspaceProjects.find((project) => resolvedTarget === project.rootRel || resolvedTarget.startsWith(`${project.rootRel}/`)) || null,
    } : {
      kind: "unresolved",
      resolvedTarget: null,
      targetProject: null,
    };
  }

  const aliasResolution = await resolveAliasImport(repoRoot, specifier, sourceFile.absolutePath, configCache);
  if (aliasResolution) {
    return {
      kind: "internal",
      resolvedTarget: aliasResolution.resolvedTarget,
      targetProject: workspaceProjects.find((project) => aliasResolution.resolvedTarget === project.rootRel || aliasResolution.resolvedTarget.startsWith(`${project.rootRel}/`)) || null,
    };
  }

  const workspaceResolution = await resolveWorkspaceImport(repoRoot, specifier, workspaceProjects);
  if (workspaceResolution) {
    return workspaceResolution.resolvedTarget ? {
      kind: "workspace",
      resolvedTarget: workspaceResolution.resolvedTarget,
      targetProject: workspaceResolution.project,
    } : {
      kind: "unresolved",
      resolvedTarget: null,
      targetProject: workspaceResolution.project,
    };
  }

  return {
    kind: "external",
    resolvedTarget: specifier,
    targetProject: null,
  };
}

export async function loadConfig(repoRoot, configRelative = DEFAULT_CONFIG_RELATIVE) {
  const absolutePath = path.resolve(repoRoot, configRelative);
  if (!(await pathExists(absolutePath))) {
    return {
      exists: false,
      relativePath: normalizePath(configRelative),
      compiled: structuredClone(DEFAULT_CONFIG),
    };
  }
  const parsed = await readJsonFile(absolutePath);
  const compiled = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(isObject(parsed) ? parsed : {}),
  };
  compiled.ignoreGlobs = sortUnique(ensureArray(compiled.ignoreGlobs));
  compiled.extraScanRoots = sortUnique(ensureArray(compiled.extraScanRoots));
  compiled.sharedRoots = sortUnique(ensureArray(compiled.sharedRoots));
  compiled.docRoots = sortUnique(ensureArray(compiled.docRoots));
  compiled.publicPrefixes = sortUnique(ensureArray(compiled.publicPrefixes));
  compiled.secretLikePatterns = sortUnique(ensureArray(compiled.secretLikePatterns));
  compiled.appPathOverrides = isObject(compiled.appPathOverrides) ? compiled.appPathOverrides : {};

  return {
    exists: true,
    relativePath: normalizePath(configRelative),
    compiled,
  };
}

function classifyFile(relativePath) {
  const normalized = normalizePath(relativePath);
  const base = path.basename(normalized);
  if (/\/\.github\/workflows\//.test(`/${normalized}`)) {
    return "ci";
  }
  if (/\/docker-compose.*\.(yml|yaml)$/i.test(`/${normalized}`) || /^docker-compose.*\.(yml|yaml)$/i.test(base)) {
    return "compose";
  }
  if (/^Dockerfile/i.test(base)) {
    return "docker";
  }
  if (/\/k8s\//.test(`/${normalized}`)) {
    return "k8s";
  }
  if (/\/helm\//.test(`/${normalized}`)) {
    return "helm";
  }
  if (/\/infra\//.test(`/${normalized}`) || /\/terraform\//.test(`/${normalized}`)) {
    return "infra";
  }
  if (/\/\.env/.test(`/${normalized}`) || /^\.(env)/i.test(base)) {
    return "envFile";
  }
  if (normalized.endsWith("/package.json") || base === "package.json") {
    return "packageJson";
  }
  if (DOC_EXTENSIONS.has(path.extname(base).toLowerCase()) || /^README/i.test(base)) {
    return "doc";
  }
  if (isSourceFile(normalized)) {
    return "source";
  }
  if (YAML_EXTENSIONS.has(path.extname(base).toLowerCase())) {
    return "yaml";
  }
  return "unknown";
}

function usageKindForFileKind(fileKind, fallback = "unknown") {
  if (fileKind === "ci") {
    return "ci";
  }
  if (fileKind === "docker" || fileKind === "compose") {
    return "container";
  }
  if (fileKind === "k8s" || fileKind === "helm" || fileKind === "infra") {
    return "infra";
  }
  if (fileKind === "doc" || fileKind === "packageJson") {
    return "doc";
  }
  return fallback;
}

function snippetForLine(line) {
  return String(line || "").trim().slice(0, 240);
}

function rawSnippetForLine(line) {
  return String(line || "").slice(0, 240);
}

function fileBaseName(value) {
  return normalizePath(value).split("/").pop() || "";
}

function isEnvExamplePath(value) {
  return fileBaseName(value) === ".env.example";
}

function isEnvExampleDefinition(entry) {
  return entry?.kind === "envFile" && isEnvExamplePath(entry.file);
}

function shouldTrackVariableName(name) {
  return /^[A-Z][A-Z0-9_]+$/.test(String(name || ""));
}

function isSecretLike(name, config) {
  return ensureArray(config.secretLikePatterns).some((pattern) => String(name || "").includes(pattern));
}

function isPublicLike(name, config) {
  return ensureArray(config.publicPrefixes).some((prefix) => String(name || "").startsWith(prefix));
}

function makeOccurrenceKey(entry) {
  return [
    entry.kind,
    entry.file,
    entry.line,
    entry.scope,
    entry.snippet || "",
  ].join("|");
}

function addDefinition(targetMap, name, entry) {
  if (!shouldTrackVariableName(name)) {
    return;
  }
  if (!targetMap.has(name)) {
    targetMap.set(name, new Map());
  }
  targetMap.get(name).set(makeOccurrenceKey(entry), entry);
}

function addUsage(targetMap, name, entry) {
  if (!shouldTrackVariableName(name)) {
    return;
  }
  if (!targetMap.has(name)) {
    targetMap.set(name, new Map());
  }
  targetMap.get(name).set(makeOccurrenceKey(entry), entry);
}

function addDynamic(targetList, entry) {
  const key = makeOccurrenceKey(entry);
  if (!targetList.some((candidate) => makeOccurrenceKey(candidate) === key)) {
    targetList.push(entry);
  }
}

function scanEnvFile(relativePath, content, scope, definitions) {
  const lines = content.split(/\r?\n/);
  if (!isEnvExamplePath(relativePath)) {
    return;
  }
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/);
    if (!match) {
      return;
    }
    const previousLine = index > 0 ? lines[index - 1] : "";
    addDefinition(definitions, match[1], {
      kind: "envFile",
      file: normalizePath(relativePath),
      line: index + 1,
      scope,
      snippet: rawSnippetForLine(line),
      comment: /^\s*#/.test(previousLine) ? rawSnippetForLine(previousLine) : "",
    });
  });
}

function scanSourceFile(relativePath, content, scope, usages, dynamicAccesses) {
  const sanitized = stripCommentsPreservingLength(content);
  const lines = sanitized.split(/\r?\n/);
  const originalLines = content.split(/\r?\n/);
  const aliasNames = sortUnique(
    Array.from(sanitized.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*process\.env\b/g)).map((match) => match[1])
  );
  const directPatterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
    /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  ];
  for (const aliasName of aliasNames) {
    directPatterns.push(new RegExp(`${escapeRegExp(aliasName)}\\.([A-Z][A-Z0-9_]+)`, "g"));
    directPatterns.push(new RegExp(`${escapeRegExp(aliasName)}\\[\\s*["']([A-Z][A-Z0-9_]+)["']\\s*\\]`, "g"));
  }

  lines.forEach((line, index) => {
    const snippet = snippetForLine(originalLines[index]);
    for (const regex of directPatterns) {
      let match;
      while ((match = regex.exec(line)) !== null) {
        const kind = /(\|\||\?\?)/.test(line.slice(match.index)) ? "default" : "read";
        addUsage(usages, match[1], {
          kind,
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
          snippet,
        });
      }
    }

    const validationContext = /\b(missing|required|validate|validation|schema|env)\b/i.test(line);
    if (validationContext) {
      let match;
      const stringPattern = /["'`]([A-Z][A-Z0-9_]+)["'`]/g;
      while ((match = stringPattern.exec(line)) !== null) {
        addUsage(usages, match[1], {
          kind: "validation",
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
          snippet,
        });
      }
    }

    const aliasDynamic = aliasNames.some((aliasName) => new RegExp(`${escapeRegExp(aliasName)}\\s*\\[\\s*[^"'\\]\\s]`).test(line)
      || new RegExp(`\\bObject\\.(keys|values|entries)\\s*\\(\\s*${escapeRegExp(aliasName)}\\s*\\)`).test(line)
      || new RegExp(`\\.\\.\\.\\s*${escapeRegExp(aliasName)}`).test(line));
    if (/process\.env\s*\[\s*[^"'`\]]/g.test(line)
      || /\bObject\.(keys|values|entries)\s*\(\s*process\.env\s*\)/.test(line)
      || /\.\.\.\s*process\.env/.test(line)
      || aliasDynamic) {
      addDynamic(dynamicAccesses, {
        kind: "dynamic",
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
        snippet,
        reason: "dynamic or enumerated process.env access",
      });
    }
  });
}

function scanYamlLikeFile(relativePath, content, scope, fileKind, definitions, usages) {
  const lines = content.split(/\r?\n/);
  const stack = [];
  lines.forEach((line, index) => {
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const blockMatch = line.match(/^\s*(env|environment)\s*:\s*$/);
    if (blockMatch) {
      stack.push({ type: blockMatch[1], indent });
    }

    const snippet = snippetForLine(line);
    const inEnvBlock = stack.some((entry) => entry.type === "env" || entry.type === "environment");

    if (inEnvBlock) {
      let match = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*:\s*(.+)?$/);
      if (match) {
        addDefinition(definitions, match[1], {
          kind: fileKind === "ci" ? "ci" : fileKind === "compose" ? "compose" : fileKind === "k8s" ? "k8s" : fileKind === "helm" ? "helm" : "infra",
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
        });
      }
      match = line.match(/^\s*-\s*([A-Z][A-Z0-9_]+)\s*=/);
      if (match) {
        addDefinition(definitions, match[1], {
          kind: fileKind === "ci" ? "ci" : fileKind === "compose" ? "compose" : fileKind === "k8s" ? "k8s" : fileKind === "helm" ? "helm" : "infra",
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
        });
      }
    }

    if (fileKind === "ci" && /GITHUB_ENV/.test(line)) {
      let match;
      const githubEnvPattern = /([A-Z][A-Z0-9_]+)=(\$\{\{[^}]+\}\}|\$\{[^}]+\}|[^"\s]+)/g;
      while ((match = githubEnvPattern.exec(line)) !== null) {
        const variableName = match[1];
        const assignedValue = match[2] || "";
        addDefinition(definitions, variableName, {
          kind: "ci",
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
        });
        if (hasShellDefaultFallback(assignedValue)) {
          addUsage(usages, variableName, {
            kind: "default",
            file: normalizePath(relativePath),
            line: index + 1,
            scope,
            snippet,
          });
        }
      }
    }

    let match;
    const expressionPattern = /\$\{([A-Z][A-Z0-9_]+)\}/g;
    while ((match = expressionPattern.exec(line)) !== null) {
      if (CI_BUILTIN_VARIABLES.has(match[1])) {
        continue;
      }
      addUsage(usages, match[1], {
        kind: usageKindForFileKind(fileKind),
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
        snippet,
      });
    }

    const shellPattern = /(^|[^$])\$([A-Z][A-Z0-9_]+)/g;
    while ((match = shellPattern.exec(line)) !== null) {
      if (CI_BUILTIN_VARIABLES.has(match[2])) {
        continue;
      }
      addUsage(usages, match[2], {
        kind: usageKindForFileKind(fileKind),
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
        snippet,
      });
    }
  });
}

function hasShellDefaultFallback(value) {
  if (typeof value !== "string" || !value.startsWith("${") || value.startsWith("${{") || !value.endsWith("}")) {
    return false;
  }

  const inner = value.slice(2, -1);
  return inner.includes(":-") || /^[A-Za-z_][A-Za-z0-9_]*-[\s\S]+$/.test(inner);
}

function scanDockerFile(relativePath, content, scope, definitions, usages) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const snippet = snippetForLine(line);
    let match;
    const argPattern = /^\s*ARG\s+([A-Z][A-Z0-9_]+)/i;
    match = line.match(argPattern);
    if (match) {
      addDefinition(definitions, match[1], {
        kind: "docker",
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
      });
    }
    const envPattern = /^\s*ENV\s+([A-Z][A-Z0-9_]+)(?:=|\s+)/i;
    match = line.match(envPattern);
    if (match) {
      addDefinition(definitions, match[1], {
        kind: "docker",
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
      });
    }
    const refPattern = /\$\{([A-Z][A-Z0-9_]+)\}/g;
    while ((match = refPattern.exec(line)) !== null) {
      addUsage(usages, match[1], {
        kind: "container",
        file: normalizePath(relativePath),
        line: index + 1,
        scope,
        snippet,
      });
    }
  });
}

function scanDocLikeFile(relativePath, content, scope, usages) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const snippet = snippetForLine(line);
    let match;
    const directPatterns = [
      /process\.env\.([A-Z][A-Z0-9_]+)/g,
      /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
      /`([A-Z][A-Z0-9_]+)`/g,
    ];
    const envishContext = /(\.env|env|environment|runtime|config|variable|variables|secret|secrets|supabase)/i.test(line);
    const tokenMatches = Array.from(line.matchAll(/`([A-Z][A-Z0-9_]+)`/g)).map((entry) => entry[1]);
    const explicitList = tokenMatches.length >= 2 || (/^\s*[-*]\s/.test(line) && tokenMatches.length >= 1);

    for (const regex of directPatterns) {
      while ((match = regex.exec(line)) !== null) {
        if (regex.source === /`([A-Z][A-Z0-9_]+)`/g.source && !envishContext && !explicitList) {
          continue;
        }
        addUsage(usages, match[1], {
          kind: "doc",
          file: normalizePath(relativePath),
          line: index + 1,
          scope,
          snippet,
        });
      }
    }
  });
}

function scanTextFile(relativePath, content, scope, definitions, usages, dynamicAccesses) {
  const fileKind = classifyFile(relativePath);
  if (fileKind === "envFile") {
    scanEnvFile(relativePath, content, scope, definitions);
    return;
  }
  if (fileKind === "source") {
    scanSourceFile(relativePath, content, scope, usages, dynamicAccesses);
    return;
  }
  if (fileKind === "ci" || fileKind === "compose" || fileKind === "k8s" || fileKind === "helm" || fileKind === "infra" || fileKind === "yaml") {
    scanYamlLikeFile(relativePath, content, scope, fileKind === "yaml" ? "infra" : fileKind, definitions, usages);
    return;
  }
  if (fileKind === "docker") {
    scanDockerFile(relativePath, content, scope, definitions, usages);
    return;
  }
  if (fileKind === "doc" || fileKind === "packageJson") {
    scanDocLikeFile(relativePath, content, scope, usages);
  }
}

function fileProbablyBelongsToApp(relativePath, appName, config) {
  const normalized = normalizePath(relativePath);
  const overrideEntries = Object.entries(isObject(config.appPathOverrides) ? config.appPathOverrides : {});
  for (const [pattern, value] of overrideEntries) {
    if (matchesGlob(normalized, pattern)) {
      return ensureArray(value).map(String).includes(appName);
    }
  }
  const tokens = normalized.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes(String(appName || "").toLowerCase());
}

async function collectCandidateFiles(repoRoot, app, config) {
  const files = [];
  const addFile = async (absolutePath, scope) => {
    if (!(await pathExists(absolutePath))) {
      return;
    }
    const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
    if (ensureArray(config.ignoreGlobs).some((pattern) => matchesGlob(relativePath, pattern))) {
      return;
    }
    files.push({ absolutePath, relativePath, scope });
  };

  const addDirectory = async (absoluteRoot, scope, predicate = () => true) => {
    await walkDirectory(absoluteRoot, async (absolutePath, relativePath) => {
      if (!predicate(absolutePath, relativePath)) {
        return;
      }
      files.push({ absolutePath, relativePath, scope });
    }, config, repoRoot);
  };

  await addDirectory(path.join(app.rootPath, "src"), "app", (absolutePath) => isSourceFile(absolutePath));
  await addDirectory(path.join(app.rootPath, "config"), "app", (absolutePath) => isSourceFile(absolutePath));
  await addDirectory(path.join(app.rootPath, "doc"), "app", (absolutePath, relativePath) => !relativePath.endsWith(".json"));

  const appEntries = await fs.readdir(app.rootPath, { withFileTypes: true });
  for (const entry of appEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (/^\.env/i.test(entry.name) || /^README/i.test(entry.name) || entry.name === "package.json") {
      await addFile(path.join(app.rootPath, entry.name), "app");
    }
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectRootFiles(repoRoot, config) {
  const files = [];
  const rootEntries = await fs.readdir(repoRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && ROOT_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      const absolutePath = path.join(repoRoot, entry.name);
      files.push({
        absolutePath,
        relativePath: normalizePath(path.relative(repoRoot, absolutePath)),
        scope: "root",
      });
    }
  }

  for (const candidate of ROOT_CONTEXT_CANDIDATES.concat(ensureArray(config.extraScanRoots))) {
    const absoluteRoot = path.join(repoRoot, candidate);
    await walkDirectory(absoluteRoot, async (absolutePath, relativePath) => {
      if (relativePath.endsWith(".json")) {
        return;
      }
      files.push({ absolutePath, relativePath, scope: "root" });
    }, config, repoRoot);
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectSourceGraphForApp(repoRoot, appProject, workspaceProjects, config) {
  const configCache = new Map();
  const discovered = new Map();
  const queue = [];

  const enqueue = async (absolutePath, project) => {
    if (!(await pathExists(absolutePath)) || !isSourceFile(absolutePath)) {
      return;
    }
    const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
    if (ensureArray(config.ignoreGlobs).some((pattern) => matchesGlob(relativePath, pattern))) {
      return;
    }
    if (!discovered.has(relativePath)) {
      discovered.set(relativePath, { absolutePath, relativePath, project });
      queue.push(discovered.get(relativePath));
    }
  };

  await walkDirectory(path.join(appProject.rootPath, "src"), async (absolutePath) => {
    if (isSourceFile(absolutePath)) {
      await enqueue(absolutePath, appProject);
    }
  }, config, repoRoot);
  await walkDirectory(path.join(appProject.rootPath, "config"), async (absolutePath) => {
    if (isSourceFile(absolutePath)) {
      await enqueue(absolutePath, appProject);
    }
  }, config, repoRoot);

  const reachablePackages = new Set();

  while (queue.length) {
    const sourceFile = queue.shift();
    const raw = await fs.readFile(sourceFile.absolutePath, "utf8");
    const imports = extractImports(raw, sourceFile.relativePath);
    for (const dependency of imports) {
      const resolution = await resolveImport({
        repoRoot,
        sourceFile,
        specifier: dependency.specifier,
        workspaceProjects,
        configCache,
      });

      if (!resolution || !resolution.resolvedTarget || !resolution.targetProject) {
        continue;
      }

      if (resolution.targetProject.ownerType === "package") {
        reachablePackages.add(resolution.targetProject.rootRel);
        if (resolution.resolvedTarget.endsWith(".js")
          || resolution.resolvedTarget.endsWith(".mjs")
          || resolution.resolvedTarget.endsWith(".cjs")
          || resolution.resolvedTarget.endsWith(".jsx")
          || resolution.resolvedTarget.endsWith(".ts")
          || resolution.resolvedTarget.endsWith(".tsx")) {
          await enqueue(path.join(repoRoot, resolution.resolvedTarget), resolution.targetProject);
        } else if (resolution.resolvedTarget === resolution.targetProject.rootRel) {
          const indexCandidate = await resolvePathLike(repoRoot, resolution.targetProject.rootPath, "src/index");
          if (indexCandidate) {
            await enqueue(path.join(repoRoot, indexCandidate), resolution.targetProject);
          }
        }
      } else if (resolution.targetProject.rootRel === appProject.rootRel) {
        await enqueue(path.join(repoRoot, resolution.resolvedTarget), resolution.targetProject);
      }
    }
  }

  return {
    files: Array.from(discovered.values()).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    reachablePackages: Array.from(reachablePackages).sort(compareStrings),
  };
}

function serializeOccurrences(entries, includeSnippet = false) {
  return entries
    .sort((left, right) => {
      if (left.file !== right.file) {
        return left.file.localeCompare(right.file);
      }
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      return String(left.snippet || "").localeCompare(String(right.snippet || ""));
    })
    .map((entry) => includeSnippet ? entry : {
      kind: entry.kind,
      file: entry.file,
      line: entry.line,
      scope: entry.scope,
    });
}

function buildReport({ app, configMeta, candidateFiles, definitions, usages, dynamicAccesses, scanWarnings }) {
  const variableNames = sortUnique([...definitions.keys(), ...usages.keys()]);
  const variables = variableNames.map((name) => {
    const definitionEntries = Array.from(definitions.get(name)?.values() || []).filter(isEnvExampleDefinition);
    const usageEntries = Array.from(usages.get(name)?.values() || []);
    return {
      name,
      secretLike: isSecretLike(name, configMeta.compiled),
      publicLike: isPublicLike(name, configMeta.compiled),
      definitions: serializeOccurrences(definitionEntries, true),
      usages: serializeOccurrences(usageEntries, true),
    };
  });

  return {
    schemaVersion: ENV_INVENTORY_SCHEMA_VERSION,
    app: {
      name: app.name,
      path: app.rootRel,
      outputPath: defaultJsonOutputForApp(app.rootRel),
    },
    scan: {
      config: {
        path: configMeta.relativePath,
        exists: configMeta.exists,
      },
      roots: {
        app: sortUnique(candidateFiles.filter((entry) => entry.scope === "app").map((entry) => path.dirname(entry.relativePath))),
        package: sortUnique(candidateFiles.filter((entry) => entry.scope === "package").map((entry) => path.dirname(entry.relativePath))),
        root: sortUnique(candidateFiles.filter((entry) => entry.scope === "root").map((entry) => path.dirname(entry.relativePath))),
      },
      ignoredGlobs: sortUnique(configMeta.compiled.ignoreGlobs),
    },
    summary: {
      totalVariables: variables.length,
      totalDefinitions: variables.reduce((total, variable) => total + variable.definitions.length, 0),
      totalUsages: variables.reduce((total, variable) => total + variable.usages.length, 0),
      secretLikeCount: variables.filter((variable) => variable.secretLike).length,
      publicLikeCount: variables.filter((variable) => variable.publicLike).length,
      dynamicAccessCount: dynamicAccesses.length,
    },
    variables,
    dynamicAccesses: dynamicAccesses
      .slice()
      .sort((left, right) => {
        if (left.file !== right.file) {
          return left.file.localeCompare(right.file);
        }
        if (left.line !== right.line) {
          return left.line - right.line;
        }
        return String(left.reason || "").localeCompare(String(right.reason || ""));
      })
      .map((entry) => ({
        file: entry.file,
        line: entry.line,
        scope: entry.scope,
        snippet: entry.snippet,
        reason: entry.reason,
      })),
    scanWarnings: scanWarnings.slice().sort(compareStrings),
  };
}

export async function generateEnvInventory({
  repoRoot,
  appsRoot = "apps",
  appName,
  configPath = DEFAULT_CONFIG_RELATIVE,
}) {
  const apps = await discoverApps(repoRoot, appsRoot);
  const app = apps.find((candidate) => candidate.name === appName);
  if (!app) {
    throw new Error(`Unknown app '${appName}' under ${appsRoot}`);
  }
  const workspaceProjects = await discoverWorkspaceProjects(repoRoot, apps);
  const appProject = workspaceProjects.find((project) => project.rootRel === app.rootRel);
  if (!appProject) {
    throw new Error(`Unable to find workspace project metadata for ${app.rootRel}`);
  }

  const configMeta = await loadConfig(repoRoot, configPath);
  const sourceGraph = await collectSourceGraphForApp(repoRoot, appProject, workspaceProjects, configMeta.compiled);
  const candidateFiles = await collectCandidateFiles(repoRoot, app, configMeta.compiled);
  const reachablePackageFiles = sourceGraph.files
    .filter((entry) => entry.project.ownerType === "package")
    .map((entry) => ({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      scope: "package",
    }));

  const rootFiles = await collectRootFiles(repoRoot, configMeta.compiled);
  const definitions = new Map();
  const usages = new Map();
  const dynamicAccesses = [];
  const scanWarnings = [];
  const includedRootFiles = new Set();

  for (const file of [...candidateFiles, ...reachablePackageFiles]) {
    const content = await fs.readFile(file.absolutePath, "utf8");
    scanTextFile(file.relativePath, content, file.scope, definitions, usages, dynamicAccesses);
  }

  const groundedVariableNames = new Set([...definitions.keys(), ...usages.keys()]);

  for (const file of rootFiles) {
    const content = await fs.readFile(file.absolutePath, "utf8");
    const scopedDefinitions = new Map();
    const scopedUsages = new Map();
    const scopedDynamic = [];
    scanTextFile(file.relativePath, content, "root", scopedDefinitions, scopedUsages, scopedDynamic);

    const fileBelongsToApp = fileProbablyBelongsToApp(file.relativePath, app.name, configMeta.compiled);
    for (const [name, entries] of scopedDefinitions.entries()) {
      if (!fileBelongsToApp && !groundedVariableNames.has(name)) {
        continue;
      }
      for (const entry of entries.values()) {
        addDefinition(definitions, name, entry);
        includedRootFiles.add(file.relativePath);
      }
    }
    for (const [name, entries] of scopedUsages.entries()) {
      if (!fileBelongsToApp && !groundedVariableNames.has(name)) {
        continue;
      }
      for (const entry of entries.values()) {
        addUsage(usages, name, entry);
        includedRootFiles.add(file.relativePath);
      }
    }
    if (fileBelongsToApp) {
      for (const entry of scopedDynamic) {
        addDynamic(dynamicAccesses, entry);
        includedRootFiles.add(file.relativePath);
      }
    }
  }

  return buildReport({
    app,
    configMeta,
    candidateFiles: [...candidateFiles, ...reachablePackageFiles, ...rootFiles.filter((file) => includedRootFiles.has(file.relativePath))],
    definitions,
    usages,
    dynamicAccesses,
    scanWarnings,
  });
}

async function writeReport(repoRoot, report) {
  const outputPath = path.join(repoRoot, report.app.outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(outputPath, serialized, "utf8");
  const legacyOutputPath = path.join(repoRoot, report.app.path, LEGACY_REPORT_RELATIVE);
  if (legacyOutputPath !== outputPath && await pathExists(legacyOutputPath)) {
    await fs.rm(legacyOutputPath, { force: true });
  }
  return serialized;
}

async function readExistingReport(repoRoot, report) {
  const outputPath = path.join(repoRoot, report.app.outputPath);
  try {
    return await fs.readFile(outputPath, "utf8");
  } catch {
    return null;
  }
}

async function legacyReportExists(repoRoot, report) {
  const legacyOutputPath = path.join(repoRoot, report.app.path, LEGACY_REPORT_RELATIVE);
  return legacyOutputPath !== path.join(repoRoot, report.app.outputPath) && pathExists(legacyOutputPath);
}

function parseCliArgs(argv) {
  const options = {
    root: ".",
    appsRoot: "apps",
    app: null,
    allApps: false,
    config: DEFAULT_CONFIG_RELATIVE,
    check: false,
    html: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--apps-root") {
      options.appsRoot = argv[++index];
    } else if (arg === "--app") {
      options.app = argv[++index];
    } else if (arg === "--all-apps") {
      options.allApps = true;
    } else if (arg === "--config") {
      options.config = argv[++index];
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--html") {
      options.html = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node /path/to/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app web",
    "  node /path/to/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps",
    "",
    "Options:",
    "  --root <path>       Repo root (default: .)",
    "  --apps-root <path>  Apps root relative to repo root (default: apps)",
    "  --app <name>        Generate one app report under /apps",
    "  --all-apps          Generate all direct app children under /apps",
    "  --config <path>     Optional config file (default: .agents/env-inventory.config.json)",
    "  --html              Generate/check apps/<app>/docs/env-inventory.html alongside JSON",
    "  --check             Verify outputs are current without rewriting them",
  ].join("\n");
}

function summarizeReport(report) {
  return `[env-inventory] ${report.app.name}: ${report.summary.totalVariables} variables, ${report.summary.totalDefinitions} definitions, ${report.summary.totalUsages} usages, ${report.summary.dynamicAccessCount} dynamic`;
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    if (!options.app && !options.allApps) {
      throw new Error("Pass --app <name> or --all-apps");
    }
    if (options.app && options.allApps) {
      throw new Error("Use only one of --app or --all-apps");
    }
    const repoRoot = path.resolve(options.root);
    const apps = await discoverApps(repoRoot, options.appsRoot);
    const targetApps = options.allApps ? apps.map((app) => app.name) : [options.app];

    let clean = true;
    for (const appName of targetApps) {
      const report = await generateEnvInventory({
        repoRoot,
        appsRoot: options.appsRoot,
        appName,
        configPath: options.config,
      });
      const next = `${JSON.stringify(report, null, 2)}\n`;
      if (options.check) {
        const previous = await readExistingReport(repoRoot, report);
        if (previous !== next) {
          clean = false;
          console.error(`[env-inventory] stale or missing report: ${report.app.outputPath}`);
        }
        if (await legacyReportExists(repoRoot, report)) {
          clean = false;
          console.error(`[env-inventory] legacy report should be removed: ${normalizePath(path.join(report.app.path, LEGACY_REPORT_RELATIVE))}`);
        }
      } else {
        await writeReport(repoRoot, report);
      }

      if (options.html) {
        const htmlRelativePath = defaultHtmlOutputForApp(report.app.path);
        const htmlOutputPath = path.join(repoRoot, htmlRelativePath);
        const htmlRendered = renderEnvInventoryHtml(report, { htmlOutputPath: htmlRelativePath });
        let previousHtml = "";
        if (await pathExists(htmlOutputPath)) {
          previousHtml = await fs.readFile(htmlOutputPath, "utf8");
        }

        if (options.check) {
          if (previousHtml !== htmlRendered) {
            clean = false;
            console.error(`[env-inventory] stale or missing report: ${htmlRelativePath}`);
          }
        } else if (previousHtml !== htmlRendered) {
          await fs.mkdir(path.dirname(htmlOutputPath), { recursive: true });
          await fs.writeFile(htmlOutputPath, htmlRendered, "utf8");
        }
      }

      console.log(summarizeReport(report));
    }

    if (options.check && !clean) {
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`[env-inventory] ${error.message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
