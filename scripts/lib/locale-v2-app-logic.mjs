import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function loadLocaleV2AppLogic() {
  const { build } = await import('esbuild');
  // Match the existing catalog focused tests: bundle real TS semantics in memory.
  const compiled = await build({
    absWorkingDir: root,
    stdin: { contents: [
      'export { resolveLocale } from "./src/lib/i18n/locale.ts";',
      'export { selectEditorialVariant } from "./src/lib/i18n/editorial-variants.ts";',
      'export { buildDetailParameterGroups, detailSpecColumns } from "./src/lib/public-product-detail.ts";',
      'export { catalogLabel } from "./src/lib/catalog-presentation.ts";',
    ].join('\n'), resolveDir: root, sourcefile: 'locale-v2-app-logic-entry.mjs' },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', metafile: true,
  });
  const logic = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const inputs = Object.keys(compiled.metafile.inputs)
    .filter(file => file !== 'locale-v2-app-logic-entry.mjs')
    .map(file => file.replaceAll(path.sep, '/')).sort();
  return { logic, inputs };
}
