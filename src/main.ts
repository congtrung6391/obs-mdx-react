
import { App, Plugin, FileView, TFile } from "obsidian";
import { MdxView, VIEW_TYPE_MDX } from "./view";
import { MdxSettingTab } from "./settings";
import { ensureReactDependenciesInstalled, CORE_REACT_DEPENDENCIES } from "./cache";

export interface MdxPluginConfig {
  name: string;
  version: string;
  options: string;
}

export interface MdxSettings {
  dependencies: Record<string, string>;
  customCss: string;
  selectedTheme: string;
  remarkPlugins: MdxPluginConfig[];
  rehypePlugins: MdxPluginConfig[];
}

export const DEFAULT_SETTINGS: MdxSettings = {
  dependencies: {
    "canvas-confetti": "1.9.3",
    "lodash-es": "4.17.21",
    "remark-frontmatter": "5.0.0"
  },
  customCss: "",
  selectedTheme: "",
  remarkPlugins: [
    { name: "remark-frontmatter", version: "5.0.0", options: "" }
  ],
  rehypePlugins: []
};

export default class MdxPlugin extends Plugin {
  declare settings: MdxSettings;

  async onload(): Promise<void> {
    await ensureReactDependenciesInstalled(this.app);
    
    // Inject native browser Import Map for react specifiers
    try {
      const adapter = this.app.vault.adapter;
      let importMapEl = document.getElementById("mdx-react-importmap");
      if (!importMapEl) {
        const getCleanResourcePath = (path: string): string => {
          const url = (adapter as any).getResourcePath(path);
          return url.split("?")[0];
        };
        const reactPath = getCleanResourcePath(".obsidian/plugins/mdx-react/.cache/react.js");
        const reactDomPath = getCleanResourcePath(".obsidian/plugins/mdx-react/.cache/react-dom.js");
        const reactDomClientPath = getCleanResourcePath(".obsidian/plugins/mdx-react/.cache/react-dom-client.js");
        const jsxRuntimePath = getCleanResourcePath(".obsidian/plugins/mdx-react/.cache/react-jsx-runtime.js");

        importMapEl = document.createElement("script");
        importMapEl.id = "mdx-react-importmap";
        importMapEl.setAttribute("type", "importmap");
        importMapEl.textContent = JSON.stringify({
          imports: {
            "react": reactPath,
            "react-dom": reactDomPath,
            "react-dom/client": reactDomClientPath,
            "react/jsx-runtime": jsxRuntimePath
          }
        });
        document.head.appendChild(importMapEl);
      }
    } catch (e) {
      console.warn("MDX Viewer: Failed to inject Import Map", e);
    }

    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_MDX,
      (leaf) => new MdxView(leaf, this)
    );

    this.registerExtensions(["mdx"], VIEW_TYPE_MDX);

    this.addRibbonIcon("file-code", "Toggle MDX Preview/Editor", () => {
      this.toggleMdxView();
    });

    this.addCommand({
      id: "toggle-mdx-preview",
      name: "Toggle MDX Preview/Editor",
      callback: () => this.toggleMdxView(),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "mdx") {
          const activeView = this.app.workspace.getActiveViewOfType(FileView);
          if (activeView && activeView.file === file) {
            const currentType = activeView.leaf.view.getViewType();
            if (currentType === VIEW_TYPE_MDX) {
              menu.addItem((item) => {
                item
                  .setTitle("Open as Markdown")
                  .setIcon("pencil")
                  .onClick(() => {
                    activeView.leaf.setViewState({
                      type: "markdown",
                      state: { file: file.path },
                    });
                  });
              });
            } else if (currentType === "markdown") {
              menu.addItem((item) => {
                item
                  .setTitle("Open MDX Preview")
                  .setIcon("file-code")
                  .onClick(() => {
                    activeView.leaf.setViewState({
                      type: VIEW_TYPE_MDX,
                      state: { file: file.path },
                    });
                  });
              });
            }
          }
        }
      })
    );

    this.addSettingTab(new MdxSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MDX);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    let dependencies = DEFAULT_SETTINGS.dependencies;
    let customCss = DEFAULT_SETTINGS.customCss;
    let selectedTheme = DEFAULT_SETTINGS.selectedTheme;
    let remarkPlugins = DEFAULT_SETTINGS.remarkPlugins;
    let rehypePlugins = DEFAULT_SETTINGS.rehypePlugins;

    if (data) {
      if (data.dependenciesJson) {
        try {
          dependencies = JSON.parse(data.dependenciesJson) as Record<string, string>;
        } catch (e) {
          console.warn("MDX Viewer: Failed to import legacy settings JSON", e);
        }
      } else if (data.dependencies) {
        dependencies = data.dependencies;
      }

      if (typeof data.customCss === "string") {
        customCss = data.customCss;
      }

      if (typeof data.selectedTheme === "string") {
        selectedTheme = data.selectedTheme;
      }

      if (Array.isArray(data.remarkPlugins)) {
        remarkPlugins = data.remarkPlugins;
      } else if (typeof data.remarkPluginsList === "string" && data.remarkPluginsList.trim()) {
        remarkPlugins = data.remarkPluginsList
          .split(",")
          .map((x: string) => x.trim())
          .filter(Boolean)
          .map((name: string) => {
            if (name === "remark-frontmatter") {
              return { name: "remark-frontmatter", version: "5.0.0", options: "" };
            }
            return { name, version: "latest", options: "" };
          });
      }

      if (Array.isArray(data.rehypePlugins)) {
        rehypePlugins = data.rehypePlugins;
      } else if (typeof data.rehypePluginsList === "string" && data.rehypePluginsList.trim()) {
        rehypePlugins = data.rehypePluginsList
          .split(",")
          .map((x: string) => x.trim())
          .filter(Boolean)
          .map((name: string) => ({ name, version: "latest", options: "" }));
      }
    }

    this.settings = { dependencies, customCss, selectedTheme, remarkPlugins, rehypePlugins };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private toggleMdxView(): void {
    const activeView = this.app.workspace.getActiveViewOfType(FileView);
    if (activeView && activeView.file && activeView.file.extension === "mdx") {
      const leaf = activeView.leaf;
      const currentType = leaf.view.getViewType();
      const nextType = currentType === VIEW_TYPE_MDX ? "markdown" : VIEW_TYPE_MDX;
      leaf.setViewState({
        type: nextType,
        state: { file: activeView.file.path },
      });
    }
  }
}
