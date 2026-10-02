import { describe, expect, test } from "bun:test";

import { createHostClient } from "../bin/lib/openagent-host.mjs";

function testClient(requests) {
  return createHostClient({
    environment: {
      OPENAGENT_PLUGIN_HOST_URL: "http://host.test/bridge",
      OPENAGENT_PLUGIN_HOST_TOKEN: "test-token",
      OPENAGENT_PLUGIN_ID: "chat-groups",
    },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, result: { accepted: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

describe("generic plugin host bridge", () => {
  test("exposes flow projections and agent wake through the shared modules", async () => {
    const requests = [];
    const client = testClient(requests);
    await client.conversation.setFlow("conversation", "branch", {
      kind: "plugin",
      state: { plugin_id: "chat-groups", status: "running" },
    });
    await client.agent.wake({
      conv_id: "conversation",
      branch_id: "branch",
      parent_checkpoint_id: null,
      text: "wake",
    });

    expect(requests.map((request) => request.operation)).toEqual([
      "conversation.flow.set",
      "agent.wake",
    ]);
    expect(requests.every((request) => request.args.plugin_id === "chat-groups")).toBe(true);
    expect(requests[1].args.parent_checkpoint_id).toBeNull();
  });

  test("rejects a missing bridge identity before sending a request", () => {
    expect(() => createHostClient({
      environment: {
        OPENAGENT_PLUGIN_HOST_URL: "http://host.test/bridge",
        OPENAGENT_PLUGIN_HOST_TOKEN: "test-token",
      },
      fetch: async () => new Response("{}", { status: 200 }),
    })).toThrow("OPENAGENT_PLUGIN_ID is not set");
  });
});
