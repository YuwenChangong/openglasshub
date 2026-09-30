import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const roots = ["src/components/forum/AuthTurnstile.tsx", "src/components/forum/useInvisibleTurnstile.ts"];
const program = ts.createProgram(roots, {
  noEmit: true, strict: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  types: ["vite/client"], esModuleInterop: true,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
}));
assert.equal(diagnostics.length, 0, "both Turnstile callers must compile together without conflicting global declarations");
for (const root of roots) assert.ok(program.getSourceFile(path.resolve(root)));
console.log("TURNSTILE_SEMANTIC_TYPES: PASS (noEmit, exact installed TypeScript/dependencies)");
