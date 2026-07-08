import { App, PluginSettingTab, Setting, TextComponent, ButtonComponent } from "obsidian";
import type MdxPlugin from "./main";
import { isDependencyCached, installDependency, CORE_REACT_DEPENDENCIES, ensureReactDependenciesInstalled } from "./cache";

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

    // 1.5. Core System Dependencies
    containerEl.createEl("h3", { text: "Core System Dependencies" });
    containerEl.createEl("p", { 
      text: "The React runtime libraries required by MDX notes. These are automatically downloaded and cached.",
      cls: "setting-item-description"
    });

    const coreHeaderRowEl = containerEl.createDiv();
    coreHeaderRowEl.style.display = "flex";
    coreHeaderRowEl.style.gap = "10px";
    coreHeaderRowEl.style.alignItems = "center";
    coreHeaderRowEl.style.marginBottom = "8px";
    coreHeaderRowEl.style.fontWeight = "bold";
    coreHeaderRowEl.style.borderBottom = "1px solid var(--background-modifier-border)";
    coreHeaderRowEl.style.paddingBottom = "5px";
    coreHeaderRowEl.style.color = "var(--text-muted)";
    coreHeaderRowEl.style.fontSize = "12px";

    const coreNameHeader = coreHeaderRowEl.createDiv({ text: "Package Name" });
    coreNameHeader.style.flex = "1.5";
    
    const coreVersionHeader = coreHeaderRowEl.createDiv({ text: "Version" });
    coreVersionHeader.style.flex = "2.5";

    const coreStatusHeader = coreHeaderRowEl.createDiv({ text: "Status" });
    coreStatusHeader.style.width = "80px";
    coreStatusHeader.style.textAlign = "center";

    const coreActionSpacer = coreHeaderRowEl.createDiv();
    coreActionSpacer.style.width = "70px";

    for (const [pkg, version] of Object.entries(CORE_REACT_DEPENDENCIES)) {
      const rowEl = containerEl.createDiv();
      rowEl.style.display = "flex";
      rowEl.style.gap = "10px";
      rowEl.style.alignItems = "center";
      rowEl.style.marginBottom = "10px";

      const pkgInput = new TextComponent(rowEl)
        .setValue(pkg)
        .setDisabled(true);
      pkgInput.inputEl.style.flex = "1.5";
      pkgInput.inputEl.style.minWidth = "0";
      pkgInput.inputEl.style.width = "0";

      const urlInput = new TextComponent(rowEl)
        .setValue(version)
        .setDisabled(true);
      urlInput.inputEl.style.flex = "2.5";
      urlInput.inputEl.style.minWidth = "0";
      urlInput.inputEl.style.width = "0";

      const statusSpan = rowEl.createEl("span");
      statusSpan.style.width = "80px";
      statusSpan.style.fontSize = "11px";
      statusSpan.style.fontWeight = "bold";
      statusSpan.style.textAlign = "center";
      
      const cached = await isDependencyCached(this.plugin.app, pkg, version);
      if (cached) {
        statusSpan.textContent = "Cached";
        statusSpan.style.color = "var(--text-success)";
      } else {
        statusSpan.textContent = "Missing";
        statusSpan.style.color = "var(--text-warning)";
      }

      const spacer = rowEl.createDiv();
      spacer.style.width = "70px";
    }

    // 2. Custom Module Mappings
    containerEl.createEl("h3", { text: "Custom Module Mappings" });
    containerEl.createEl("p", { 
      text: "Map package names to versions (like package.json) to cache them locally, or absolute ESM CDN URLs. Notes can import these packages by name.",
      cls: "setting-item-description"
    });

    const dependencies = this.plugin.settings.dependencies;

    // Check cache status for all dependencies up-front
    const cacheStatus: Record<string, "cached" | "missing" | "custom"> = {};
    for (const [pkg, versionOrUrl] of Object.entries(dependencies)) {
      if (versionOrUrl.startsWith("http://") || versionOrUrl.startsWith("https://")) {
        cacheStatus[pkg] = "custom";
      } else {
        const cached = await isDependencyCached(this.plugin.app, pkg, versionOrUrl);
        cacheStatus[pkg] = cached ? "cached" : "missing";
      }
    }

    // Render header row if there are dependencies
    if (Object.keys(dependencies).length > 0) {
      const headerRowEl = containerEl.createDiv();
      headerRowEl.style.display = "flex";
      headerRowEl.style.gap = "10px";
      headerRowEl.style.alignItems = "center";
      headerRowEl.style.marginBottom = "8px";
      headerRowEl.style.fontWeight = "bold";
      headerRowEl.style.borderBottom = "1px solid var(--background-modifier-border)";
      headerRowEl.style.paddingBottom = "5px";
      headerRowEl.style.color = "var(--text-muted)";
      headerRowEl.style.fontSize = "12px";

      const nameHeader = headerRowEl.createDiv({ text: "Package Name" });
      nameHeader.style.flex = "1.5";
      
      const versionHeader = headerRowEl.createDiv({ text: "Version or CDN URL" });
      versionHeader.style.flex = "2.5";

      const statusHeader = headerRowEl.createDiv({ text: "Status" });
      statusHeader.style.width = "80px";
      statusHeader.style.textAlign = "center";

      const actionHeader = headerRowEl.createDiv({ text: "Action" });
      actionHeader.style.width = "70px";
      actionHeader.style.textAlign = "center";
    } else {
      const emptyEl = containerEl.createDiv({ text: "No dependencies mapped yet. Click 'Add Dependency' to start." });
      emptyEl.style.color = "var(--text-muted)";
      emptyEl.style.fontSize = "13px";
      emptyEl.style.marginBottom = "15px";
    }

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
      pkgInput.inputEl.style.flex = "1.5";
      pkgInput.inputEl.style.minWidth = "0";
      pkgInput.inputEl.style.width = "0";

      const urlInput = new TextComponent(rowEl)
        .setValue(url)
        .setPlaceholder("Version or URL (e.g. 4.17.21)");
      urlInput.inputEl.style.flex = "2.5";
      urlInput.inputEl.style.minWidth = "0";
      urlInput.inputEl.style.width = "0";

      const statusSpan = rowEl.createEl("span");
      statusSpan.style.width = "80px";
      statusSpan.style.fontSize = "11px";
      statusSpan.style.fontWeight = "bold";
      statusSpan.style.textAlign = "center";
      
      const status = cacheStatus[pkg];
      if (status === "custom") {
        statusSpan.textContent = "Custom URL";
        statusSpan.style.color = "var(--text-muted)";
      } else if (status === "cached") {
        statusSpan.textContent = "Cached";
        statusSpan.style.color = "var(--text-success)";
      } else {
        statusSpan.textContent = "Missing";
        statusSpan.style.color = "var(--text-warning)";
      }

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

      const deleteBtn = new ButtonComponent(rowEl)
        .setButtonText("Delete")
        .setWarning();
      deleteBtn.buttonEl.style.width = "70px";
      deleteBtn.buttonEl.style.justifyContent = "center";
      deleteBtn.onClick(async () => {
        delete dependencies[pkg];
        await this.plugin.saveSettings();
        this.display(); // Refresh UI
      });
    }

    // Cache manager status line & Action Buttons row
    const actionsRowEl = containerEl.createDiv();
    actionsRowEl.style.display = "flex";
    actionsRowEl.style.justifyContent = "space-between";
    actionsRowEl.style.alignItems = "center";
    actionsRowEl.style.marginTop = "15px";
    actionsRowEl.style.marginBottom = "25px";

    const statusRow = actionsRowEl.createDiv();
    statusRow.style.fontSize = "13px";
    statusRow.style.color = "var(--text-muted)";
    statusRow.textContent = "Status: Cache up-to-date.";

    const buttonsContainer = actionsRowEl.createDiv();
    buttonsContainer.style.display = "flex";
    buttonsContainer.style.gap = "10px";

    new ButtonComponent(buttonsContainer)
      .setButtonText("Add Dependency")
      .onClick(async () => {
        const tempKey = "package-" + (Object.keys(dependencies).length + 1);
        dependencies[tempKey] = "";
        await this.plugin.saveSettings();
        this.display(); // Refresh UI
      });

    const installBtn = new ButtonComponent(buttonsContainer)
      .setButtonText("Install / Update Cache")
      .setCta()
      .onClick(async () => {
        installBtn.setDisabled(true);
        installBtn.setButtonText("Installing...");
        statusRow.style.color = "var(--text-accent)";
        
        try {
          statusRow.textContent = "Installing core React dependencies...";
          await ensureReactDependenciesInstalled(this.plugin.app, (msg) => {
            statusRow.textContent = `[Core]: ${msg}`;
          });

          for (const [pkg, versionOrUrl] of Object.entries(dependencies)) {
            if (versionOrUrl.startsWith("http://") || versionOrUrl.startsWith("https://") || !versionOrUrl.trim()) {
              continue;
            }
            
            await installDependency(this.plugin.app, pkg, versionOrUrl, (msg) => {
              statusRow.textContent = `[${pkg}]: ${msg}`;
            });
          }

          // Install Remark plugins
          for (const p of this.plugin.settings.remarkPlugins || []) {
            if (p.name && p.version && !p.version.startsWith("http://") && !p.version.startsWith("https://")) {
              await installDependency(this.plugin.app, p.name, p.version, (msg) => {
                statusRow.textContent = `[${p.name}]: ${msg}`;
              });
            }
          }

          // Install Rehype plugins
          for (const p of this.plugin.settings.rehypePlugins || []) {
            if (p.name && p.version && !p.version.startsWith("http://") && !p.version.startsWith("https://")) {
              await installDependency(this.plugin.app, p.name, p.version, (msg) => {
                statusRow.textContent = `[${p.name}]: ${msg}`;
              });
            }
          }
          statusRow.textContent = "Cache installation complete!";
          statusRow.style.color = "var(--text-success)";
        } catch (e) {
          statusRow.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
          statusRow.style.color = "var(--text-error)";
        } finally {
          installBtn.setDisabled(false);
          installBtn.setButtonText("Install / Update Cache");
          setTimeout(() => this.display(), 1500);
        }
      });


    // 3. Custom MDX Plugins
    this.renderPluginList(
      containerEl,
      "Default Remark Plugins",
      "Remark plugins to apply to all MDX notes during compilation.",
      this.plugin.settings.remarkPlugins,
      true
    );

    this.renderPluginList(
      containerEl,
      "Default Rehype Plugins",
      "Rehype plugins to apply to all MDX notes during compilation.",
      this.plugin.settings.rehypePlugins,
      false
    );
    // 4. Global Custom Styles
    containerEl.createEl("h3", { text: "Global Custom Styles" });
    const cssSetting = new Setting(containerEl)
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

    cssSetting.settingEl.style.flexDirection = "column";
    cssSetting.settingEl.style.alignItems = "stretch";
    cssSetting.settingEl.style.gap = "10px";
    cssSetting.controlEl.style.width = "100%";
    cssSetting.controlEl.style.justifyContent = "stretch";
  }

  renderPluginList(
    containerEl: HTMLElement,
    title: string,
    desc: string,
    plugins: Array<{ name: string; version: string; options: string }>,
    isRemark: boolean
  ) {
    containerEl.createEl("h4", { text: title });
    const descEl = containerEl.createDiv({ text: desc, cls: "setting-item-description" });
    descEl.style.marginBottom = "15px";

    // Header row
    if (plugins.length > 0) {
      const headerRowEl = containerEl.createDiv();
      headerRowEl.style.display = "flex";
      headerRowEl.style.gap = "10px";
      headerRowEl.style.alignItems = "center";
      headerRowEl.style.marginBottom = "8px";
      headerRowEl.style.fontWeight = "bold";
      headerRowEl.style.borderBottom = "1px solid var(--background-modifier-border)";
      headerRowEl.style.paddingBottom = "5px";
      headerRowEl.style.color = "var(--text-muted)";
      headerRowEl.style.fontSize = "12px";

      const nameHeader = headerRowEl.createDiv({ text: "Plugin Name" });
      nameHeader.style.flex = "1.5";
      
      const versionHeader = headerRowEl.createDiv({ text: "Version" });
      versionHeader.style.flex = "1.0";

      const optionsHeader = headerRowEl.createDiv({ text: "Options (JSON)" });
      optionsHeader.style.flex = "2.0";

      const statusHeader = headerRowEl.createDiv({ text: "Status" });
      statusHeader.style.width = "80px";
      statusHeader.style.textAlign = "center";

      const actionHeader = headerRowEl.createDiv({ text: "Action" });
      actionHeader.style.width = "70px";
      actionHeader.style.textAlign = "center";
    } else {
      const emptyEl = containerEl.createDiv({ text: `No ${isRemark ? "Remark" : "Rehype"} plugins added yet.` });
      emptyEl.style.color = "var(--text-muted)";
      emptyEl.style.fontSize = "13px";
      emptyEl.style.marginBottom = "15px";
    }

    // Render each plugin row
    plugins.forEach((plugin, index) => {
      const rowEl = containerEl.createDiv();
      rowEl.style.display = "flex";
      rowEl.style.gap = "10px";
      rowEl.style.alignItems = "center";
      rowEl.style.marginBottom = "10px";

      const nameInput = new TextComponent(rowEl)
        .setValue(plugin.name)
        .setPlaceholder("e.g. remark-gfm");
      nameInput.inputEl.style.flex = "1.5";
      nameInput.inputEl.style.minWidth = "0";
      nameInput.inputEl.style.width = "0";

      const versionInput = new TextComponent(rowEl)
        .setValue(plugin.version)
        .setPlaceholder("e.g. 4.0.0");
      versionInput.inputEl.style.flex = "1.0";
      versionInput.inputEl.style.minWidth = "0";
      versionInput.inputEl.style.width = "0";

      const optionsInput = new TextComponent(rowEl)
        .setValue(plugin.options)
        .setPlaceholder('e.g. {"theme": "github-dark"}');
      optionsInput.inputEl.style.flex = "2.0";
      optionsInput.inputEl.style.minWidth = "0";
      optionsInput.inputEl.style.width = "0";

      const statusSpan = rowEl.createEl("span");
      statusSpan.style.width = "80px";
      statusSpan.style.fontSize = "11px";
      statusSpan.style.fontWeight = "bold";
      statusSpan.style.textAlign = "center";

      // Check cache status:
      if (plugin.name && plugin.version) {
        isDependencyCached(this.plugin.app, plugin.name, plugin.version).then((cached) => {
          if (cached) {
            statusSpan.textContent = "Cached";
            statusSpan.style.color = "var(--text-success)";
          } else {
            statusSpan.textContent = "Missing";
            statusSpan.style.color = "var(--text-warning)";
          }
        });
      } else {
        statusSpan.textContent = "Empty";
        statusSpan.style.color = "var(--text-muted)";
      }

      const updatePlugin = async () => {
        const newName = nameInput.getValue().trim();
        const newVersion = versionInput.getValue().trim();
        const newOptions = optionsInput.getValue().trim();

        if (newName && newVersion) {
          plugins[index] = { name: newName, version: newVersion, options: newOptions };
          await this.plugin.saveSettings();
        }
      };

      nameInput.inputEl.addEventListener("blur", updatePlugin);
      versionInput.inputEl.addEventListener("blur", updatePlugin);
      optionsInput.inputEl.addEventListener("blur", updatePlugin);

      const deleteBtn = new ButtonComponent(rowEl)
        .setButtonText("Delete")
        .setWarning();
      deleteBtn.buttonEl.style.width = "70px";
      deleteBtn.buttonEl.style.justifyContent = "center";
      deleteBtn.onClick(async () => {
        plugins.splice(index, 1);
        await this.plugin.saveSettings();
        this.display(); // Refresh UI
      });
    });

    // Add button
    const addBtnContainer = containerEl.createDiv();
    addBtnContainer.style.display = "flex";
    addBtnContainer.style.justifyContent = "flex-end";
    addBtnContainer.style.marginTop = "10px";
    addBtnContainer.style.marginBottom = "20px";

    new ButtonComponent(addBtnContainer)
      .setButtonText("Add Plugin")
      .onClick(async () => {
        plugins.push({ name: "", version: "", options: "" });
        await this.plugin.saveSettings();
        this.display(); // Refresh UI
      });
  }
}
