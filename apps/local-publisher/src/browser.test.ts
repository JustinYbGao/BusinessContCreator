import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { launchFixtureSession } from "./browser.js";

describe("publisher browser boundary", () => {
  it("opens the fixture only through the explicit fixture-mode exception", async () => {
    const session = await launchFixtureSession(resolve(import.meta.dirname, "../../../packages/test-support/fixtures/xhs-editor.html"));
    try {
      expect(session.currentUrl()).toMatch(/^file:/);
      expect(session.guardViolations()).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
