import { describe, expect, it } from "vitest";
import {
  INTERNAL_SYSTEM_ACTOR_ID,
  type WorkspaceLookupPort,
  requireInternalWorkspace,
} from "./workspace-context.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function workspaceLookup(exists = true): WorkspaceLookupPort {
  return { exists: async () => exists };
}

describe("requireInternalWorkspace", () => {
  it("returns only the configured Workspace and stable system actor", async () => {
    await expect(requireInternalWorkspace(
      workspaceLookup(),
      { INTERNAL_WORKSPACE_ID: workspaceId },
    )).resolves.toEqual({
      workspaceId,
      actorId: INTERNAL_SYSTEM_ACTOR_ID,
    });
  });

  it("rejects a missing or malformed Workspace configuration", async () => {
    await expect(requireInternalWorkspace(workspaceLookup(), {}))
      .rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });

    await expect(requireInternalWorkspace(
      workspaceLookup(),
      { INTERNAL_WORKSPACE_ID: "not-a-uuid" },
    )).rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });
  });

  it("rejects a configured Workspace that does not exist", async () => {
    await expect(requireInternalWorkspace(
      workspaceLookup(false),
      { INTERNAL_WORKSPACE_ID: workspaceId },
    )).rejects.toMatchObject({ status: 500, code: "WORKSPACE_NOT_CONFIGURED" });
  });

  it("fails closed when Workspace lookup is unavailable", async () => {
    const unavailableLookup: WorkspaceLookupPort = {
      exists: async () => {
        throw new Error("database unavailable");
      },
    };

    await expect(requireInternalWorkspace(
      unavailableLookup,
      { INTERNAL_WORKSPACE_ID: workspaceId },
    )).rejects.toMatchObject({ status: 500, code: "WORKSPACE_UNAVAILABLE" });
  });
});
