import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const productionFiles = [
  resolve(import.meta.dirname, "../../../packages/xhs-adapter/src/prefill.ts"),
  resolve(import.meta.dirname, "browser.ts"),
  resolve(import.meta.dirname, "index.ts"),
];

const forbiddenCallNames = new Set(["click", "press", "submit", "evaluate", "dispatchEvent"]);

function collectForbiddenCalls(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (forbiddenCallNames.has(name)) violations.push(`${fileName}:${name}`);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "keyboard") {
      violations.push(`${fileName}:keyboard`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

describe("local publisher no-final-publish contract", () => {
  it("does not expose click, keyboard submit, form submit, evaluate, or dispatch APIs", async () => {
    const violations: string[] = [];
    for (const file of productionFiles) {
      violations.push(...collectForbiddenCalls(await readFile(file, "utf8"), file));
    }
    expect(violations).toEqual([]);
  });
});
