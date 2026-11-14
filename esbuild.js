const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

// The sidebar webview app: ES modules under media/sidebar/, bundled into a
// single classic script (dist/media/sidebar.js) that getHtml() loads after the
// global media/*.js helpers.
/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ["media/sidebar/main.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "dist/media/sidebar.js",
  sourcemap: !production,
  minify: false,
  logLevel: "info",
};

function copyMedia() {
  const src = path.join(__dirname, "media");
  const dest = path.join(__dirname, "dist", "media");
  fs.mkdirSync(dest, { recursive: true });
  // Top-level files only: media/sidebar/ holds the bundled app's sources,
  // which reach dist/ through webviewOptions, never as raw modules.
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
  }
  // Copy the codicon font so it can be used inside the webview
  const codicons = path.join(__dirname, "node_modules", "@vscode", "codicons", "dist");
  fs.copyFileSync(path.join(codicons, "codicon.css"), path.join(dest, "codicon.css"));
  fs.copyFileSync(path.join(codicons, "codicon.ttf"), path.join(dest, "codicon.ttf"));

  // Generate the list of unique codicon names for the icons picker. The CSS
  // classes are the single source of truth for what actually renders, and one
  // glyph often has several alias classes pointing at the same codepoint. To
  // keep the picker free of duplicates, group the classes by codepoint and
  // keep only the shortest name per codepoint (ties keep the first, canonical
  // name that appears in the CSS).
  const css = fs.readFileSync(path.join(codicons, "codicon.css"), "utf8");
  const shortestByCode = new Map();
  const classRe = /\.codicon-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g;
  let match;
  while ((match = classRe.exec(css)) !== null) {
    const name = match[1];
    const code = match[2];
    const current = shortestByCode.get(code);
    if (current === undefined || name.length < current.length) {
      shortestByCode.set(code, name);
    }
  }
  const names = Array.from(shortestByCode.values()).sort();
  fs.writeFileSync(path.join(dest, "codicon-names.js"), "window.CODICON_NAMES = " + JSON.stringify(names) + ";\n");
}

async function main() {
  copyMedia();
  if (watch) {
    const contexts = await Promise.all([esbuild.context(options), esbuild.context(webviewOptions)]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("[esbuild] watching for changes...");
  } else {
    await Promise.all([esbuild.build(options), esbuild.build(webviewOptions)]);
    console.log("[esbuild] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
