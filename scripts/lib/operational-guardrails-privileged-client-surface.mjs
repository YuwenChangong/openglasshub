import ts from "typescript";

const genericFactoryName = /^(?:create|with)(?:ServiceRole|Privileged|Service).*Client/i;
const rawClientType = /\bSupabaseClient\b/;

function isExported(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function typeText(node, sourceFile) {
  return node ? node.getText(sourceFile) : "";
}

function isRawClientType(node, sourceFile) {
  const text = typeText(node, sourceFile);
  return rawClientType.test(text) && !/\bPick\s*<|\bOmit\s*</.test(text);
}

export function findPrivilegedClientSurfaceFindings(source, fileName = "fixture.ts") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const findings = [];

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && isExported(node)) {
      const name = node.name?.text ?? "<anonymous>";
      if (isRawClientType(node.type, sourceFile) && /SUPABASE_SERVICE_ROLE_KEY/.test(source)) {
        findings.push("exported-raw-client-return");
      }
      if (genericFactoryName.test(name)) findings.push("exported-generic-client-factory");
      for (const parameter of node.parameters) {
        if (ts.isFunctionTypeNode(parameter.type) && isRawClientType(parameter.type, sourceFile)) {
          findings.push("exported-raw-client-callback");
        }
      }
    }

    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        const declarationText = declaration.getText(sourceFile);
        if (isRawClientType(declaration.type, sourceFile) || /createClient\([\s\S]*SUPABASE_SERVICE_ROLE_KEY/.test(declarationText)) {
          findings.push("exported-raw-client-value");
        }
        if (/SUPABASE_SERVICE_ROLE_KEY/.test(declarationText)) findings.push("exported-service-role-environment");
      }
    }

    if (ts.isExportDeclaration(node) && /(?:service-role|privileged|supabase)/i.test(node.getText(sourceFile))) {
      findings.push("privileged-client-re-export");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (/\.from\(\s*(?!["'])\w+/.test(source)) findings.push("arbitrary-table-name");
  if (/\.rpc\(\s*(?!["'])\w+/.test(source)) findings.push("arbitrary-rpc-name");
  if (/\.auth\.admin\b/.test(source)) findings.push("generic-auth-admin-exposure");
  if (/\.storage\b/.test(source)) findings.push("generic-storage-exposure");
  return [...new Set(findings)].sort();
}
