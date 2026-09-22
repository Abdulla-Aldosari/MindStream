const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"'
  }
};

function copyMedia() {
  const src = path.join(__dirname, 'media');
  const dest = path.join(__dirname, 'dist', 'media');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
  // Copy the codicon font so it can be used inside the webview
  const codicons = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
  fs.copyFileSync(path.join(codicons, 'codicon.css'), path.join(dest, 'codicon.css'));
  fs.copyFileSync(path.join(codicons, 'codicon.ttf'), path.join(dest, 'codicon.ttf'));
}

async function main() {
  copyMedia();
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
