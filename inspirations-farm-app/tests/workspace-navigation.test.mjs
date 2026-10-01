import assert from "node:assert/strict";
import test from "node:test";

import { WORKSPACE_NAV } from "../src/components/app-shell/navigation-config.ts";

test("workspace navigation exposes four deep-linkable destinations", () => {
  assert.deepEqual(
    WORKSPACE_NAV.map((item) => item.href),
    ["/", "/inspirations", "/jottings", "/bench"],
  );

  const hrefs = new Set(WORKSPACE_NAV.map((item) => item.href));
  assert.equal(hrefs.size, WORKSPACE_NAV.length);

  for (const item of WORKSPACE_NAV) {
    assert.ok(item.label.trim().length > 0);
  }
});

test("workspace navigation uses renderable icon ids", () => {
  const allowedIcons = new Set(["calendar", "lightbulb", "notebook", "flask"]);

  for (const item of WORKSPACE_NAV) {
    assert.ok(allowedIcons.has(item.icon));
  }
});
