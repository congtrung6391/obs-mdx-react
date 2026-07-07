# Obsidian MDX React

Render `.mdx` notes dynamically in Obsidian utilizing a **React 18** runtime environment. This plugin enables interactive React components, relative code imports, custom stylesheets, global dependency mappings, and custom MDX plugins (Remark/Rehype) directly inside your vault.

---

## Features

* **Strategy A (Custom FileView)**: Registers `.mdx` as a first-class file extension, rendering compiled MDX content by default.
* **Edit/Preview Toggle**: Dual-mode leaf toggle lets you switch between the native Obsidian Markdown editor and the MDX React preview. Easily toggle via:
  - Tab header actions (Pencil icon)
  - Global hotkey command (`Toggle MDX Preview/Editor`)
  - Left sidebar ribbon icon (File Code icon)
* **Sandboxed Styling (Shadow DOM)**: 
  - **Inherit Theme (Default)**: Blends natively with the active Obsidian theme, inheriting background textures (e.g., dotted backgrounds), typography, and custom variables.
  - **Theme Override**: Select an installed vault theme from the settings panel to apply specifically to MDX previews. The theme is dynamically sandboxed using Shadow DOM, preventing styles from leaking into the rest of the Obsidian UI.
* **Live Reloading**: Automatically re-renders the preview in real-time when the active file (or its imported relative files) is saved.
* **React Error Boundary**: Catches and displays render-time exceptions and stack traces directly inside the preview tab, preventing blank screens.

---

## Dependency & Module Resolution

To comply with Obsidian's strict Content Security Policy (CSP), the plugin rewrites ESM imports at compile-time and resolves them hierarchically:

1. **Pre-bundled Core**:
   - `react`, `react-dom`, `react-dom/client`, and `react/jsx-runtime` are statically pre-bundled in the plugin.
   - External dependencies loaded via CDN are automatically routed to this single React instance via a native browser **Import Map**, preventing multi-instance dispatcher conflicts (like `useState of null` errors).
2. **Local Vault Imports**:
   - Relative imports (e.g. `import { helper } from "./utils.js"`) resolve to the local file in the vault and load using Obsidian's secure `app://` protocol.
3. **Custom Declared Dependencies (Frontmatter)**:
   - Map module specifiers to absolute CDN paths inside individual notes:
     ```yaml
     ---
     dependencies:
       "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3"
     ---
     ```
4. **Global Dependency Mappings (Settings Tab)**:
   - Configure vault-wide npm package redirects (e.g., mapping `"lodash-es"` to `"https://esm.sh/lodash-es@4"`) using a clean row-based settings interface inside Obsidian.
5. **Undeclared Packages**:
   - Any bare npm package imports not listed in settings or frontmatter automatically fall back to fetching via `esm.sh`.

---

## Custom Stylesheets

* **Local Imports**: Import `.css` stylesheets relative to your note:
  ```mdx
  import "./styles.css";
  ```
  The plugin automatically fetches the stylesheet and injects it into the DOM container (or shadow root) as an inline `<style>` block, bypassing CSP blocks.
* **Global Custom CSS**: Write vault-wide MDX stylesheet rules inside the plugin's settings tab.

---

## Custom MDX Plugins (Remark/Rehype)

Extend the MDX parser with custom plugins loaded dynamically from `esm.sh` or local vault files.

### Configuration
Plugins can be configured globally in settings or per-note in YAML frontmatter. It supports both plain string lists and configured tuples `[pluginName, options]`:

```yaml
---
remarkPlugins:
  # 1. Plain plugin
  - remark-gfm
  # 2. Configured plugin tuple
  - - "@code-hike/mdx@0.9.0"
    - theme: "one-dark-pro"
      lineNumbers: true
---

import "https://esm.sh/@code-hike/mdx@0.9.0/dist/index.css";

# Code Hike Demo

<CH.Code>

```js
const val = "Hello from Code Hike";
console.log(val);
```

</CH.Code>
```

---

## Installation & Development

1. Copy the plugin directory into your vault’s plugins folder: `.obsidian/plugins/mdx-react/`.
2. Enable **MDX React** under `Settings > Community plugins`.
3. To build the source code after editing:
   ```bash
   npm run build
   ```
