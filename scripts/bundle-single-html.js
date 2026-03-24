const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const htmlPath = path.join(projectRoot, "index.html");
const cssPath = path.join(projectRoot, "src", "styles", "main.css");
const entryPath = path.join(projectRoot, "src", "main.js");
const versionStatePath = path.join(__dirname, "version-state.json");

const modules = new Map();

function toPosix(filePath) {
  return `/${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

function findImportSpecifiers(source) {
  const matches = [];
  const importPattern = /import\s+[\s\S]*?\s+from\s+["'](.+?)["'];?/g;
  let match = importPattern.exec(source);
  while (match) {
    matches.push(match[1]);
    match = importPattern.exec(source);
  }
  return matches;
}

function collectModule(filePath) {
  const id = toPosix(filePath);
  if (modules.has(id)) {
    return id;
  }

  const source = fs.readFileSync(filePath, "utf8");
  for (const specifier of findImportSpecifiers(source)) {
    if (!specifier.startsWith(".")) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const normalized = path.extname(resolved) ? resolved : `${resolved}.js`;
    collectModule(normalized);
  }

  modules.set(id, source);
  return id;
}

function resolveImportPath(currentId, specifier) {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const currentPath = path.join(projectRoot, currentId.slice(1));
  const resolved = path.resolve(path.dirname(currentPath), specifier);
  const normalized = path.extname(resolved) ? resolved : `${resolved}.js`;
  return toPosix(normalized);
}

function transformModule(id, source) {
  const exportedNames = [];
  let transformed = source;

  transformed = transformed.replace(
    /import\s+([\s\S]*?)\s+from\s+["'](.+?)["'];?/g,
    (match, clause, specifier) => {
      const resolved = resolveImportPath(id, specifier);
      const trimmed = clause.trim();

      if (trimmed.startsWith("{")) {
        return `const ${trimmed} = __require("${resolved}");`;
      }

      if (trimmed.startsWith("* as ")) {
        return `const ${trimmed.slice(5).trim()} = __require("${resolved}");`;
      }

      return `const ${trimmed} = __require("${resolved}");`;
    },
  );

  transformed = transformed.replace(/export\s+class\s+([A-Za-z_$][\w$]*)/g, (match, name) => {
    exportedNames.push(name);
    return `class ${name}`;
  });

  transformed = transformed.replace(/export\s+function\s+([A-Za-z_$][\w$]*)/g, (match, name) => {
    exportedNames.push(name);
    return `function ${name}`;
  });

  transformed = transformed.replace(/export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/g, (match, keyword, name) => {
    exportedNames.push(name);
    return `${keyword} ${name}`;
  });

  transformed = transformed.replace(/export\s*\{\s*([^}]+)\s*\};?/g, (match, list) => {
    for (const part of list.split(",")) {
      const [original] = part.trim().split(/\s+as\s+/);
      if (original) {
        exportedNames.push(original.trim());
      }
    }
    return "";
  });

  const uniqueNames = [...new Set(exportedNames)];
  if (uniqueNames.length) {
    transformed += `\nObject.assign(exports, { ${uniqueNames.join(", ")} });\n`;
  }

  return transformed;
}

function buildBundleScript() {
  const blocks = [];
  for (const [id, source] of modules.entries()) {
    blocks.push(`"${id}": function(exports, __require) {\n${transformModule(id, source)}\n}`);
  }

  return `(function () {
  const __modules = {
    ${blocks.join(",\n    ")}
  };
  const __cache = {};
  function __require(id) {
    if (__cache[id]) {
      return __cache[id];
    }
    const factory = __modules[id];
    if (!factory) {
      throw new Error("Module not found: " + id);
    }
    const exports = {};
    __cache[id] = exports;
    factory(exports, __require);
    return exports;
  }
  __require("${toPosix(entryPath)}");
})();`;
}

function readVersionState() {
  if (!fs.existsSync(versionStatePath)) {
    return { lastVersion: null };
  }
  return JSON.parse(fs.readFileSync(versionStatePath, "utf8"));
}

function writeVersionState(state) {
  fs.writeFileSync(versionStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid version "${version}". Expected semver like 1.0.0.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function nextSequentialVersion(lastVersion) {
  if (!lastVersion) {
    return "1.0.0";
  }
  const parsed = parseVersion(lastVersion);
  return formatVersion({
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch + 1,
  });
}

function nextBumpedVersion(lastVersion, bump) {
  if (!lastVersion) {
    return "1.0.0";
  }

  const parsed = parseVersion(lastVersion);
  if (bump === "minor") {
    return formatVersion({
      major: parsed.major,
      minor: parsed.minor + 1,
      patch: 0,
    });
  }

  if (bump === "major") {
    return formatVersion({
      major: parsed.major + 1,
      minor: 0,
      patch: 0,
    });
  }

  return nextSequentialVersion(lastVersion);
}

function isAllowedNextVersion(lastVersion, explicitVersion) {
  if (!lastVersion) {
    return explicitVersion === "1.0.0";
  }

  const previous = parseVersion(lastVersion);
  const next = parseVersion(explicitVersion);

  const patchBump =
    next.major === previous.major && next.minor === previous.minor && next.patch === previous.patch + 1;
  const minorBump =
    next.major === previous.major && next.minor === previous.minor + 1 && next.patch === 0;
  const majorBump = next.major === previous.major + 1 && next.minor === 0 && next.patch === 0;

  return patchBump || minorBump || majorBump;
}

function resolveVersion() {
  const state = readVersionState();
  const explicitVersion = process.argv[2] || null;
  const expectedNext = nextSequentialVersion(state.lastVersion);

  if (!explicitVersion) {
    return {
      version: expectedNext,
      state,
    };
  }

  if (explicitVersion === "patch" || explicitVersion === "minor" || explicitVersion === "major") {
    return {
      version: nextBumpedVersion(state.lastVersion, explicitVersion),
      state,
    };
  }

  parseVersion(explicitVersion);
  if (!isAllowedNextVersion(state.lastVersion, explicitVersion)) {
    throw new Error(
      `Refusing version "${explicitVersion}". Expected a patch, minor, or major semver bump after "${state.lastVersion ?? "none"}". Default next patch is "${expectedNext}".`,
    );
  }

  return {
    version: explicitVersion,
    state,
  };
}

function bundle() {
  const { version, state } = resolveVersion();
  collectModule(entryPath);
  const htmlTemplate = fs.readFileSync(htmlPath, "utf8");
  const style = fs.readFileSync(cssPath, "utf8");
  const bundleScript = buildBundleScript();
  const outputName = `paperio-lite-${version}.html`;
  const versionedOutputPath = path.join(distDir, outputName);
  const latestOutputPath = path.join(distDir, "paperio-single.html");

  const bundled = htmlTemplate
    .replace(/<title>Paper\.io Lite<\/title>/, `<title>Paper.io Lite ${version}</title>`)
    .replace(/<link rel="stylesheet" href="\.\/src\/styles\/main\.css" \/>/, `<style>\n${style}\n</style>`)
    .replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, `<script>\n${bundleScript}\n</script>`);

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(versionedOutputPath, bundled, "utf8");
  fs.writeFileSync(latestOutputPath, bundled, "utf8");
  writeVersionState({
    ...state,
    lastVersion: version,
  });
  console.log(`Bundled single HTML -> ${versionedOutputPath}`);
  console.log(`Updated latest alias -> ${latestOutputPath}`);
}

bundle();
