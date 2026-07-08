import { App, requestUrl } from "obsidian";

const CACHE_DIR = ".obsidian/plugins/mdx-react/.cache";
const MANIFEST_PATH = `${CACHE_DIR}/manifest.json`;

export interface CacheManifest {
  cached: Record<string, {
    version: string;
    file: string;
    timestamp: number;
  }>;
}

export async function ensureCacheDirectoryExists(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(CACHE_DIR))) {
    await adapter.mkdir(CACHE_DIR);
  }
}

export const CORE_REACT_DEPENDENCIES: Record<string, string> = {
  "react": "18.3.1",
  "react-dom": "18.3.1",
  "react-dom/client": "18.3.1",
  "react/jsx-runtime": "18.3.1"
};

export async function ensureReactDependenciesInstalled(app: App, onProgress?: (msg: string) => void): Promise<void> {
  await ensureCacheDirectoryExists(app);
  for (const [name, version] of Object.entries(CORE_REACT_DEPENDENCIES)) {
    const cached = await isDependencyCached(app, name, version);
    if (!cached) {
      console.log(`MDX Viewer: Core dependency ${name}@${version} is missing, installing...`);
      try {
        await installDependency(app, name, version, onProgress);
      } catch (e) {
        console.error(`MDX Viewer: Failed to install core dependency ${name}@${version}`, e);
      }
    }
  }

  // Migrate any existing cached dependencies to fix absolute /node/ imports
  const adapter = app.vault.adapter;
  try {
    const files = await adapter.list(CACHE_DIR);
    for (const file of files.files) {
      if (file.endsWith(".js") && !file.endsWith("manifest.json")) {
        try {
          let content = await adapter.read(file);
          if (content.includes('"/node/') || content.includes("'/node/")) {
            content = content
              .replace(/(from\s*['"])\/node\/(.*?)(['"])/g, '$1https://esm.sh/node/$2$3')
              .replace(/(import\(\s*['"])\/node\/(.*?)(['"]\s*\))/g, '$1https://esm.sh/node/$2$3');
            await adapter.write(file, content);
            console.log(`MDX Viewer: Migrated node polyfills in cached file ${file}`);
          }
        } catch (e) {
          console.warn(`MDX Viewer: Failed to migrate cached file ${file}`, e);
        }
      }
    }
  } catch (e) {
    console.warn("MDX Viewer: Failed to list cache directory for migration", e);
  }
}

export async function readManifest(app: App): Promise<CacheManifest> {
  const adapter = app.vault.adapter;
  if (await adapter.exists(MANIFEST_PATH)) {
    try {
      const content = await adapter.read(MANIFEST_PATH);
      return JSON.parse(content);
    } catch (e) {
      console.warn("Failed to read cache manifest, resetting...", e);
    }
  }
  return { cached: {} };
}

export async function writeManifest(app: App, manifest: CacheManifest): Promise<void> {
  const adapter = app.vault.adapter;
  await ensureCacheDirectoryExists(app);
  await adapter.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

export async function isDependencyCached(app: App, name: string, version: string): Promise<boolean> {
  const adapter = app.vault.adapter;
  const isCore = name === "react" || name === "react-dom" || name === "react-dom/client" || name === "react/jsx-runtime";
  const fileName = isCore 
    ? `${name.replace(/\//g, "-")}.js` 
    : `${name.replace(/\//g, "-")}@${version}.js`;
  const filePath = `${CACHE_DIR}/${fileName}`;
  
  if (!(await adapter.exists(filePath))) return false;
  
  const manifest = await readManifest(app);
  return manifest.cached[name]?.version === version;
}

export function getCachedDependencyUrl(app: App, name: string, version: string): string {
  const isCore = name === "react" || name === "react-dom" || name === "react-dom/client" || name === "react/jsx-runtime";
  const fileName = isCore 
    ? `${name.replace(/\//g, "-")}.js` 
    : `${name.replace(/\//g, "-")}@${version}.js`;
  const filePath = `${CACHE_DIR}/${fileName}`;
  const url = (app.vault.adapter as any).getResourcePath(filePath);
  return url.split("?")[0];
}

function getPackageAndSubpath(name: string): { pkgName: string; subpath: string } {
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length > 2) {
      return {
        pkgName: `${parts[0]}/${parts[1]}`,
        subpath: "/" + parts.slice(2).join("/")
      };
    }
  } else {
    const parts = name.split("/");
    if (parts.length > 1) {
      return {
        pkgName: parts[0],
        subpath: "/" + parts.slice(1).join("/")
      };
    }
  }
  return { pkgName: name, subpath: "" };
}

export async function installDependency(
  app: App,
  name: string,
  version: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  await ensureCacheDirectoryExists(app);
  
  // Custom URLs are not fetched/cached
  if (version.startsWith("http://") || version.startsWith("https://")) {
    return;
  }
  
  onProgress?.(`Fetching ${name}@${version} from CDN...`);
  
  let queryParams = "?bundle";
  if (name === "react-dom") {
    queryParams += "&external=react";
  } else if (name.startsWith("react-dom/")) {
    queryParams += "&external=react,react-dom";
  } else if (name === "react/jsx-runtime" || name.startsWith("react/")) {
    queryParams += "&external=react";
  } else if (name !== "react") {
    queryParams += "&external=react,react-dom";
  }

  // Request bundled ESM version from esm.sh, putting version before the subpath
  const { pkgName, subpath } = getPackageAndSubpath(name);
  const url = `https://esm.sh/${pkgName}@${version}${subpath}${queryParams}`;
  const response = await requestUrl(url);
  
  if (response.status !== 200) {
    throw new Error(`Failed to fetch ${name}@${version}: HTTP ${response.status}`);
  }
  
  const headers = response.headers || {};
  const esmPathKey = Object.keys(headers).find(k => k.toLowerCase() === "x-esm-path");
  const esmPath = esmPathKey ? headers[esmPathKey] : null;
  
  let code = response.text;
  if (esmPath) {
    onProgress?.(`Downloading bundle source...`);
    const bundleUrl = `https://esm.sh${esmPath}`;
    const bundleResponse = await requestUrl(bundleUrl);
    if (bundleResponse.status !== 200) {
      throw new Error(`Failed to download bundle for ${name}@${version}: HTTP ${bundleResponse.status}`);
    }
    code = bundleResponse.text;
  }

  // Follow esm.sh redirection wrappers (200 OK with export * from "/...")
  let redirectMatch = code.match(/export\s+\*\s+from\s*['"](\/.*?)['"]/);
  let depth = 0;
  while (redirectMatch && depth < 3) {
    try {
      const targetUrl = `https://esm.sh${redirectMatch[1]}`;
      const redirectResponse = await requestUrl(targetUrl);
      if (redirectResponse.status === 200) {
        code = redirectResponse.text;
        redirectMatch = code.match(/export\s+\*\s+from\s*['"](\/.*?)['"]/);
        depth++;
      } else {
        break;
      }
    } catch (e) {
      console.warn("MDX Viewer: Failed to follow esm.sh redirect wrapper", e);
      break;
    }
  }
  onProgress?.(`Rewriting module imports for React compatibility...`);
  
  // Replace bare specifier imports of react / react-dom with relative references to our wrappers
  code = code
    .replace(/(from\s*['"])\/node\/(.*?)(['"])/g, '$1https://esm.sh/node/$2$3')
    .replace(/(import\(\s*['"])\/node\/(.*?)(['"]\s*\))/g, '$1https://esm.sh/node/$2$3');
    
  const isCore = name === "react" || name === "react-dom" || name === "react-dom/client" || name === "react/jsx-runtime";
  const fileName = isCore 
    ? `${name.replace(/\//g, "-")}.js` 
    : `${name.replace(/\//g, "-")}@${version}.js`;
  const filePath = `${CACHE_DIR}/${fileName}`;
  onProgress?.(`Saving package to local storage...`);
  await app.vault.adapter.write(filePath, code);
  
  // Update manifest
  const manifest = await readManifest(app);
  manifest.cached[name] = {
    version,
    file: fileName,
    timestamp: Date.now()
  };
  await writeManifest(app, manifest);
}
