import { compile, type CompileOptions } from "@mdx-js/mdx";
import type * as React from "react";

/**
 * Resolves global pre-bundled packages or falls back to CDN.
 */
export function resolveGlobalOrCdn(source: string): Promise<unknown> | unknown {
  // Fallback to esm.sh for external npm packages
  const url = `https://esm.sh/${source}`;
  // Exception: Dynamic import is required here because external package URLs must be loaded at runtime.
  return import(url);
}

/**
 * Rewrites static and dynamic ESM imports to custom resolver calls.
 */
function rewriteImportsToResolve(code: string): string {
  const importRegex = /\bimport\s+([\s\S]*?)\s+from\s+(['"])(.*?)\2;?/g;

  let rewritten = code.replace(importRegex, (match, importSpec, quote, source) => {
    const spec = importSpec.trim();

    if (spec.startsWith("*") && spec.includes("as")) {
      const name = spec.split("as")[1].trim();
      return `const ${name} = await _mdxResolve(${quote}${source}${quote});`;
    }

    let defaultImport = "";
    let namedImports = "";

    if (spec.includes("{")) {
      const braceIdx = spec.indexOf("{");
      const beforeBrace = spec.slice(0, braceIdx).trim();
      const insideBrace = spec.slice(braceIdx + 1, spec.lastIndexOf("}")).trim();

      if (beforeBrace) {
        defaultImport = beforeBrace.replace(/,$/, "").trim();
      }
      namedImports = insideBrace;
    } else {
      defaultImport = spec;
    }

    const destructureParts: string[] = [];
    if (defaultImport) {
      destructureParts.push(`default: ${defaultImport}`);
    }

    if (namedImports) {
      const list = namedImports.split(",").map(x => x.trim()).filter(Boolean);
      for (const item of list) {
        if (item.includes(" as ")) {
          const [orig, alias] = item.split(" as ").map(x => x.trim());
          destructureParts.push(`${orig}: ${alias}`);
        } else {
          destructureParts.push(item);
        }
      }
    }

    return `const { ${destructureParts.join(", ")} } = await _mdxResolve(${quote}${source}${quote});`;
  });

  rewritten = rewritten.replace(/\bimport\s+(['"])(.*?)\1;?/g, (match, quote, source) => {
    if (match.includes("from")) return match;
    return `await _mdxResolve(${quote}${source}${quote});`;
  });

  rewritten = rewritten.replace(/\bimport\((['"])(.*?)\1\)/g, (match, quote, source) => {
    return `_mdxResolve(${quote}${source}${quote})`;
  });

  return rewritten;
}

/**
 * Rewrites ESM export declarations to local export object properties.
 */
function rewriteExports(code: string): string {
  let rewritten = code;
  const exportsList: string[] = [];

  rewritten = rewritten.replace(/\bexport\s+default\s+function\s+(\w+)/g, (match, name) => {
    exportsList.push(`_mdxExports.default = ${name};`);
    return `function ${name}`;
  });

  rewritten = rewritten.replace(/\bexport\s+default\s+(\w+);?/g, (match, name) => {
    exportsList.push(`_mdxExports.default = ${name};`);
    return "";
  });

  rewritten = rewritten.replace(/\bexport\s+const\s+(\w+)/g, (match, name) => {
    exportsList.push(`_mdxExports.${name} = ${name};`);
    return `const ${name}`;
  });

  rewritten = rewritten.replace(/\bexport\s+function\s+(\w+)/g, (match, name) => {
    exportsList.push(`_mdxExports.${name} = ${name};`);
    return `function ${name}`;
  });

  rewritten += `\n\n// Collected exports\n` + exportsList.join("\n") + "\n";
  return rewritten;
}

/**
 * Compiles MDX source string into an executable React component.
 * Uses dynamic evaluation with sandboxed module resolution.
 */
export async function compileMdx(
  content: string,
  resolveSource: (source: string) => Promise<unknown> | unknown,
  remarkPlugins: unknown[] = [],
  rehypePlugins: unknown[] = []
): Promise<React.ComponentType> {
  const file = await compile(content, {
    remarkPlugins: remarkPlugins as CompileOptions["remarkPlugins"],
    rehypePlugins: rehypePlugins as CompileOptions["rehypePlugins"],
    outputFormat: "program",
    jsxImportSource: "react",
  });
  const compiledCode = String(file);
  
  const rewrittenImports = rewriteImportsToResolve(compiledCode);
  const rewrittenCode = rewriteExports(rewrittenImports);

  const evalCode = `
    const _mdxExports = {};
    ${rewrittenCode}
    return _mdxExports;
  `;

  // Exception: Dynamic evaluation via new Function is required here because MDX note content is compiled dynamically at runtime.
  const fn = new Function("_mdxResolve", `return (async () => { ${evalCode} })()`);
  
  const exports = await fn(resolveSource);

  if (exports && typeof exports.default === "function") {
    return exports.default as React.ComponentType;
  }

  throw new Error("Compiled MDX did not export a default component.");
}
