import { describe, expect, it } from "vitest";
import * as campaignsRoute from "./campaigns/route";
import * as productsRoute from "./products/route";
import * as publicationsRoute from "./publications/route";
import * as selectTopicRoute from "./topics/select/route";

const allowedRouteExports = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

describe("Next route module export boundaries", () => {
  it("keeps dependency-injected handlers out of route modules", () => {
    const routes = [
      campaignsRoute,
      productsRoute,
      publicationsRoute,
      selectTopicRoute,
    ];

    for (const route of routes) {
      const unexpectedExports = Object.keys(route).filter((name) => !allowedRouteExports.has(name));
      expect(unexpectedExports).toEqual([]);
    }
  });
});
