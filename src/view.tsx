import { App, FileView, WorkspaceLeaf, TFile, normalizePath, getFrontMatterInfo, parseYaml, requestUrl } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { compileMdx, resolveGlobalOrCdn } from "./compiler";
import type MdxPlugin from "./main";

export const VIEW_TYPE_MDX = "mdx-js-view";

function resolveRelativePath(basePath: string, relativePath: string): string {
  const parts = basePath.split("/").filter(Boolean);
  const relParts = relativePath.split("/");
  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function resolvePluginUrl(source: string, activeFile: TFile | null, app: App): string {
  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("data:")) {
    return source;
  }

  if (source.startsWith(".") && activeFile && app) {
    const parentPath = activeFile.parent ? activeFile.parent.path : "";
    const resolvedPath = normalizePath(resolveRelativePath(parentPath, source));
    const targetFile = app.vault.getAbstractFileByPath(resolvedPath);
    if (targetFile instanceof TFile) {
      return app.vault.getResourcePath(targetFile);
    }
  }

  return `https://esm.sh/${source}?external=react,react-dom`;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class MdxErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("MDX Render Error:", error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mdx-error-container" style={{ padding: "20px", color: "var(--text-error)" }}>
          <h3>MDX Render Error</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error ? this.state.error.message : "Unknown rendering error"}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "11px", color: "var(--text-muted)" }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export class MdxView extends FileView {
  private root: ReactDOM.Root | null = null;
  private container: HTMLDivElement | null = null;
  private targetContainer: HTMLElement | ShadowRoot | null = null;

  plugin: MdxPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: MdxPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  async loadPlugins(pluginsList: unknown[], isRemark: boolean): Promise<unknown[]> {
    const loaded = await Promise.all(
      pluginsList.map(async (item) => {
        let name = "";
        let config: unknown = null;
        let isArrayItem = false;

        if (Array.isArray(item)) {
          isArrayItem = true;
          name = String(item[0]);
          
          // Merge all subsequent config items into a single options object
          const mergedConfig: Record<string, unknown> = {};
          for (let i = 1; i < item.length; i++) {
            const configPart = item[i];
            if (configPart && typeof configPart === "object") {
              Object.assign(mergedConfig, configPart);
            }
          }
          config = mergedConfig;
        } else if (typeof item === "string") {
          name = item;
        }

        if (!name) return null;

        try {
          const url = resolvePluginUrl(name, this.file, this.app);
          // Exception: Dynamic import is required here because plugin packages are runtime-configured by the user.
          const module = await import(url);
          
          let pluginFunc = module.default;
          if (!pluginFunc) {
            const keys = Object.keys(module);
            const targetPrefix = isRemark ? "remark" : "rehype";
            const matchingKey = keys.find(k => k.toLowerCase().startsWith(targetPrefix) && typeof module[k] === "function");
            
            if (matchingKey) {
              pluginFunc = module[matchingKey];
            } else {
              const firstFuncKey = keys.find(k => typeof module[k] === "function");
              if (firstFuncKey) {
                pluginFunc = module[firstFuncKey];
              }
            }
          }

          if (typeof pluginFunc !== "function") {
            console.warn(`MDX Viewer: Resolved export for plugin "${name}" is not a function.`);
            return null;
          }

          return isArrayItem ? [pluginFunc, config] : pluginFunc;
        } catch (e) {
          console.warn(`MDX Viewer: Failed to load plugin "${name}"`, e);
          return null;
        }
      })
    );
    return loaded.filter((p): p is unknown => p !== null);
  }
  onload(): void {
    super.onload();
    // Live reload when the currently active MDX file is modified
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.file && this.file) {
          this.renderFile(this.file);
        }
      })
    );
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.addAction("pencil", "Edit MDX as Markdown", () => {
      if (this.file) {
        this.leaf.setViewState({
          type: "markdown",
          state: { file: this.file.path },
        });
      }
    });
  }

  getViewType(): string {
    return VIEW_TYPE_MDX;
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : "MDX File";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.contentEl.addClass("markdown-reading-view");
    this.contentEl.empty();
    const themeName = this.plugin.settings.selectedTheme;

    if (themeName) {
      const shadowRoot = this.contentEl.shadowRoot || this.contentEl.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = "";
      
      const container = document.createElement("div");
      container.className = "markdown-preview-view markdown-rendered mdx-view-container";
      shadowRoot.appendChild(container);
      
      this.container = container;
      this.targetContainer = shadowRoot;
    } else {
      const container = this.contentEl.createDiv({ cls: "markdown-preview-view markdown-rendered mdx-view-container" });
      this.container = container;
      this.targetContainer = this.contentEl;
    }

    await this.renderFile(file);
  }

  async renderFile(file: TFile): Promise<void> {
    const targetContainer = this.targetContainer;
    if (!this.container || !targetContainer) return;

    // Store the active target container globally for the dynamic ESM loader
    const w = window as unknown as Record<string, unknown>;
    w._activeMdxContainer = targetContainer;

    try {
      const content = await this.app.vault.read(file);
      let frontmatter: Record<string, unknown> = {};
      const fmInfo = getFrontMatterInfo(content);
      if (fmInfo.exists && fmInfo.frontmatter) {
        try {
          frontmatter = parseYaml(fmInfo.frontmatter) as Record<string, unknown>;
        } catch (e) {
          console.warn("MDX Viewer: Failed to parse YAML frontmatter", e);
        }
      }

      const customDeps = (frontmatter.dependencies || {}) as Record<string, string>;

      const remarkFrontmatter = frontmatter.remarkPlugins;
      const remarkPluginsList: unknown[] = Array.isArray(remarkFrontmatter)
        ? remarkFrontmatter
        : (this.plugin.settings.remarkPluginsList || "")
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);

      const rehypeFrontmatter = frontmatter.rehypePlugins;
      const rehypePluginsList: unknown[] = Array.isArray(rehypeFrontmatter)
        ? rehypeFrontmatter
        : (this.plugin.settings.rehypePluginsList || "")
            .split(",")
            .map(x => x.trim())
            .filter(Boolean);

      const [remarkPlugins, rehypePlugins] = await Promise.all([
        this.loadPlugins(remarkPluginsList, true),
        this.loadPlugins(rehypePluginsList, false)
      ]);

      const settingsDeps = this.plugin.settings.dependencies || {};

      const resolveSource = async (source: string): Promise<unknown> => {
        // Handle CSS imports globally (both local files and CDN URLs)
        if (source.endsWith(".css")) {
          let cssContent = "";
          
          if (source.startsWith(".")) {
            const parentPath = file.parent ? file.parent.path : "";
            const resolvedPath = normalizePath(resolveRelativePath(parentPath, source));
            const targetFile = this.app.vault.getAbstractFileByPath(resolvedPath);
            if (targetFile instanceof TFile) {
              try {
                cssContent = await this.app.vault.read(targetFile);
              } catch (e) {
                console.warn("MDX Viewer: Failed to read local CSS file", e);
              }
            }
          } else {
            try {
              const response = await requestUrl(source);
              cssContent = response.text;
            } catch (e) {
              console.warn("MDX Viewer: Failed to fetch CDN CSS stylesheet", e);
            }
          }
          
          if (cssContent) {
            const styleId = "mdx-css-" + source.replace(/[^a-zA-Z0-9]/g, "-");
            let styleEl = targetContainer.querySelector(`#${styleId}`) as HTMLStyleElement | null;
            if (!styleEl) {
              styleEl = document.createElement("style");
              styleEl.id = styleId;
              targetContainer.appendChild(styleEl);
            }
            styleEl.textContent = cssContent;
          }
          return {}; // Return empty module object
        }

        if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("data:")) {
          return await import(source);
        }

        if (source in customDeps) {
          return await import(customDeps[source]);
        }

        if (source in settingsDeps) {
          return await import(settingsDeps[source]);
        }

        if (source.startsWith(".")) {
          const parentPath = file.parent ? file.parent.path : "";
          const resolvedPath = normalizePath(resolveRelativePath(parentPath, source));
          const targetFile = this.app.vault.getAbstractFileByPath(resolvedPath);
          if (targetFile instanceof TFile) {
            const resourceUrl = this.app.vault.getResourcePath(targetFile);
            return await import(resourceUrl);
          }
        }

        return await resolveGlobalOrCdn(source);
      };

      const MDXComponent = await compileMdx(content, resolveSource, remarkPlugins, rehypePlugins);

      // 1. Inject Theme Override CSS if active
      const themeName = this.plugin.settings.selectedTheme;
      const themeStyleId = "mdx-theme-styles";
      let themeStyleEl = targetContainer.querySelector(`#${themeStyleId}`) as HTMLStyleElement | null;
      if (themeName) {
        try {
          const themeCss = await this.app.vault.adapter.read(`.obsidian/themes/${themeName}/theme.css`);
          if (!themeStyleEl) {
            themeStyleEl = document.createElement("style");
            themeStyleEl.id = themeStyleId;
            targetContainer.appendChild(themeStyleEl);
          }
          themeStyleEl.textContent = themeCss;
        } catch (e) {
          console.warn("MDX Viewer: Failed to load theme override", e);
          if (themeStyleEl) themeStyleEl.remove();
        }
      } else if (themeStyleEl) {
        themeStyleEl.remove();
      }

      // 2. Inject global custom settings CSS
      const styleId = "mdx-settings-styles";
      let styleEl = targetContainer.querySelector(`#${styleId}`) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        targetContainer.appendChild(styleEl);
      }
      styleEl.textContent = this.plugin.settings.customCss || "";

      if (!this.root) {
        const reactDomUrl = "https://esm.sh/react-dom@18.3.1/client";
        const ReactDOMClientCDN = (await import(reactDomUrl)) as unknown as {
          createRoot: (container: Element) => { render: (node: React.ReactNode) => void };
        };
        this.root = ReactDOMClientCDN.createRoot(this.container) as unknown as ReactDOM.Root;
      }

      this.root.render(
        <React.StrictMode>
          <div className="mdx-content">
            <MdxErrorBoundary>
              <MDXComponent />
            </MdxErrorBoundary>
          </div>
        </React.StrictMode>
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.root) {
        this.root.render(
          <div className="mdx-error-container" style={{ padding: "20px", color: "var(--text-error)" }}>
            <h3>MDX Compilation Error</h3>
            <pre style={{ whiteSpace: "pre-wrap" }}>{message}</pre>
          </div>
        );
      } else {
        const errDiv = this.container?.createDiv({ cls: "mdx-error-container" });
        if (errDiv) {
          errDiv.style.padding = "20px";
          errDiv.style.color = "var(--text-error)";
          errDiv.createEl("h3", { text: "MDX Compilation Error" });
          const preEl = errDiv.createEl("pre", { text: message }) as HTMLPreElement;
          preEl.style.whiteSpace = "pre-wrap";
        }
      }
    }
  }
  async onUnloadFile(file: TFile): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.container = null;
    await super.onUnloadFile(file);
  }
}
