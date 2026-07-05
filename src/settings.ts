import { App, PluginSettingTab, Setting, TextComponent, ButtonComponent } from "obsidian";
import type MdxPlugin from "./main";

export class MdxSettingTab extends PluginSettingTab {
  plugin: MdxPlugin;

  constructor(app: App, plugin: MdxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.renderSettings();
  }

  async renderSettings(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "MDX Viewer Settings" });

    // 1. Theme Override Dropdown
    const themesDir = ".obsidian/themes";
    let themes: string[] = [];
    try {
      const result = await this.app.vault.adapter.list(themesDir);
      themes = result.folders.map(f => f.split("/").pop() || "");
    } catch (e) {
      // Themes directory does not exist or list failed
    }

    const themeOptions: Record<string, string> = { "": "Default (Inherit Active Theme)" };
    for (const theme of themes) {
      themeOptions[theme] = theme;
    }

    new Setting(containerEl)
      .setName("Theme Override")
      .setDesc("Select a specific theme to style the MDX preview, or inherit the active vault theme.")
      .addDropdown(dropdown => dropdown
        .addOptions(themeOptions)
        .setValue(this.plugin.settings.selectedTheme || "")
        .onChange(async (value) => {
          this.plugin.settings.selectedTheme = value;
          await this.plugin.saveSettings();
        })
      );

    // 2. Custom Module Mappings
    containerEl.createEl("h3", { text: "Custom Module Mappings" });
    containerEl.createEl("p", { 
      text: "Map package names to absolute ESM CDN URLs or absolute paths. Notes can import these packages by name.",
      cls: "setting-item-description"
    });

    const dependencies = this.plugin.settings.dependencies;

    // Render each dependency as a row
    for (const [pkg, url] of Object.entries(dependencies)) {
      const rowEl = containerEl.createDiv();
      rowEl.style.display = "flex";
      rowEl.style.gap = "10px";
      rowEl.style.alignItems = "center";
      rowEl.style.marginBottom = "10px";

      const pkgInput = new TextComponent(rowEl)
        .setValue(pkg)
        .setPlaceholder("Package Name (e.g. lodash-es)");
      pkgInput.inputEl.style.flex = "1";

      const urlInput = new TextComponent(rowEl)
        .setValue(url)
        .setPlaceholder("URL (e.g. https://esm.sh/lodash-es)");
      urlInput.inputEl.style.flex = "2";

      const updateDependency = async () => {
        const newPkg = pkgInput.getValue().trim();
        const newUrl = urlInput.getValue().trim();

        if (newPkg && newUrl) {
          if (newPkg !== pkg) {
            delete dependencies[pkg];
          }
          dependencies[newPkg] = newUrl;
          await this.plugin.saveSettings();
        }
      };

      pkgInput.inputEl.addEventListener("blur", updateDependency);
      urlInput.inputEl.addEventListener("blur", updateDependency);

      new ButtonComponent(rowEl)
        .setButtonText("Delete")
        .setWarning()
        .onClick(async () => {
          delete dependencies[pkg];
          await this.plugin.saveSettings();
          this.display(); // Refresh UI
        });
    }

    // Add Button Row
    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText("Add Dependency")
        .setCta()
        .onClick(async () => {
          const tempKey = "package-" + (Object.keys(dependencies).length + 1);
          dependencies[tempKey] = "";
          await this.plugin.saveSettings();
          this.display(); // Refresh UI
        })
      );

    // 3. Custom MDX Plugins
    containerEl.createEl("h3", { text: "Custom MDX Plugins" });
    new Setting(containerEl)
      .setName("Default Remark Plugins")
      .setDesc("A comma-separated list of remark plugin names (e.g. remark-gfm) to apply to all MDX notes.")
      .addText(text => text
        .setPlaceholder("remark-gfm")
        .setValue(this.plugin.settings.remarkPluginsList || "")
        .onChange(async (value) => {
          this.plugin.settings.remarkPluginsList = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default Rehype Plugins")
      .setDesc("A comma-separated list of rehype plugin names (e.g. rehype-slug) to apply to all MDX notes.")
      .addText(text => text
        .setPlaceholder("rehype-slug")
        .setValue(this.plugin.settings.rehypePluginsList || "")
        .onChange(async (value) => {
          this.plugin.settings.rehypePluginsList = value;
          await this.plugin.saveSettings();
        })
      );

    // 4. Global Custom Styles
    containerEl.createEl("h3", { text: "Global Custom Styles" });
    new Setting(containerEl)
      .setName("Custom CSS")
      .setDesc("Write custom CSS rules to style your MDX notes globally. These apply to the MDX preview pane.")
      .addTextArea(text => text
        .setPlaceholder("/* Custom CSS styles */")
        .setValue(this.plugin.settings.customCss)
        .onChange(async (value) => {
          this.plugin.settings.customCss = value;
          await this.plugin.saveSettings();
        })
        .then(area => {
          area.inputEl.style.width = "100%";
          area.inputEl.rows = 8;
          area.inputEl.style.fontFamily = "monospace";
        })
      );
  }
}
