// Bundle definitions shared by the build and the third-party notices generator.
// The extension host (Node, CommonJS) and the webviews (browser) are bundled separately.

/**
 * @param {{ production: boolean }} options
 * @returns {import('esbuild').BuildOptions[]}
 */
export function bundles({ production }) {
  /** @type {import('esbuild').BuildOptions} */
  const common = {
    bundle: true,
    minify: production,
    sourcemap: production ? false : 'linked',
    legalComments: 'linked',
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
  };

  return [
    {
      ...common,
      entryPoints: ['src/extension/extension.ts'],
      outdir: 'dist/extension',
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['vscode'],
    },
    {
      ...common,
      // One bundle per notation: dist/webview/<notation>.js + <notation>.css (+ font/image files).
      entryPoints: { bpmn: 'src/webview/notations/bpmn/main.ts' },
      outdir: 'dist/webview',
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
      loader: {
        '.woff': 'file',
        '.woff2': 'file',
        '.ttf': 'file',
        '.eot': 'file',
        '.svg': 'file',
        '.png': 'file',
      },
      assetNames: '[name]-[hash]',
    },
  ];
}
