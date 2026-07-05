import { App, Plugin, FileView, TFile } from "obsidian";
import { MdxView, VIEW_TYPE_MDX } from "./view";
import { MdxSettingTab } from "./settings";

export interface MdxSettings {
  dependencies: Record<string, string>;
  customCss: string;
  selectedTheme: string;
  remarkPluginsList: string;
  rehypePluginsList: string;
}

export const DEFAULT_SETTINGS: MdxSettings = {
  dependencies: {
    "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3",
    "lodash-es": "https://esm.sh/lodash-es@4.17.21"
  },
  customCss: "",
  selectedTheme: "",
  remarkPluginsList: "",
  rehypePluginsList: ""
};

export default class MdxPlugin extends Plugin {
  declare settings: MdxSettings;

  async onload(): Promise<void> {
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
    let remarkPluginsList = DEFAULT_SETTINGS.remarkPluginsList;
    let rehypePluginsList = DEFAULT_SETTINGS.rehypePluginsList;

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

      if (typeof data.remarkPluginsList === "string") {
        remarkPluginsList = data.remarkPluginsList;
      }

      if (typeof data.rehypePluginsList === "string") {
        rehypePluginsList = data.rehypePluginsList;
      }
    }

    this.settings = { dependencies, customCss, selectedTheme, remarkPluginsList, rehypePluginsList };
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
