import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { createJunctionClient } from "../src/api/client.ts";
import { createGuardedFetch } from "../src/api/guard.ts";
import { createJunctionServer } from "../src/server.ts";
import { FakeTrpcError, fakePlatform, sampleEvent, sampleTeam } from "./fake-platform.ts";

const handlers = {
  "event.getMyEvents": () => [sampleEvent],
  "event.getEventAnnouncements": () => [
    { id: 1, eventId: 7, title: "Old", content: null, createdAt: "2026-11-13 10:00:00", updatedAt: "" },
    { id: 2, eventId: 7, title: "New", content: "Food!", createdAt: "2026-11-13 18:00:00", updatedAt: "" },
  ],
  "event.getEventChallenges": () => [
    { id: 298, eventId: 7, trackId: 106, name: "Internet Butler", description: "Build an agent", insights: null, resources: null, image: null },
  ],
  "event.getEventSideChallenges": () => [
    { id: 29, eventId: 7, trackId: 1, name: "Best use of Exa", description: "Use Exa", insights: null, resources: null, image: null },
  ],
  "teams.getMyTeam": () => sampleTeam,
  "teams.getMyTeamMembers": () => [
    { userId: 1, externalUserId: "user_1", role: "lead", name: "Ada", imageUrl: "", emailAddresses: [{ emailAddress: "ada@example.com" }] },
  ],
  "teams.getTeamInterests": () => [{ id: 1, eventId: 7, teamId: 10, challengeId: 298 }],
  "project.getTeamProjects": () => [{ id: 7, name: "Jeeves", punchline: null, description: null, challengeId: 298, updatedAt: "u1" }],
  "project.getProjectLinks": () => [{ type: "demo", link: "https://example.com" }],
  "project.getProjectSideChallenges": () => [{ sideChallengeId: 29 }],
  "project.getProjectSubmission": () => null,
  "project.saveProjectSubmission": () => ({ projectId: 7, updatedAt: "u2" }),
  "teams.setTableNumber": () => null,
  "teams.setTeamInterests": () => null,
};

async function connect(
  options: {
    allowWrites?: boolean;
    handlers?: typeof handlers;
    /** How the user answers confirmation prompts; null for a client without elicitation support. */
    elicit?: ElicitResult["action"] | null;
  } = {},
) {
  const platform = fakePlatform({ ...handlers, ...options.handlers });
  const api = createJunctionClient({
    getToken: () => "token",
    fetch: createGuardedFetch({ fetch: platform.fetch, minIntervalMs: 0 }),
  });
  const server = createJunctionServer({ api, allowWrites: options.allowWrites });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const elicit = options.elicit === undefined ? "accept" : options.elicit;
  const client = new Client({ name: "test", version: "0" }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
  const prompts: string[] = [];
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      prompts.push(request.params.message);
      return { action: elicit };
    });
  }
  await client.connect(clientTransport);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return { isError: Boolean(result.isError), text: content!.text, json: () => JSON.parse(content!.text) };
  };
  return { platform, client, call, prompts };
}

test("exposes write tools by default and leaves them out when writes are off", async () => {
  const writable = await connect();
  const writableNames = (await writable.client.listTools()).tools.map((t) => t.name);
  assert.ok(writableNames.includes("save_project_draft"));
  assert.ok(writableNames.includes("submit_project"));

  const readOnly = await connect({ allowWrites: false });
  const names = (await readOnly.client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("get_my_projects"));
  assert.ok(!names.includes("save_project_draft"));
  assert.ok(!names.includes("submit_project"));
});

test("writes ask the user to confirm before changing anything", async () => {
  const { platform, call, prompts } = await connect();
  const result = await call("set_team_interests", { challengeIds: [298] });
  assert.ok(!result.isError);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /Internet Butler/);
  assert.deepEqual(platform.inputs.get("teams.setTeamInterests"), [{ teamId: 10, eventId: 7, challengeIds: [298] }]);
});

for (const [action, answered] of [["decline", "declined"], ["cancel", "cancelled"]] as const) {
  test(`a ${answered} confirmation sends nothing`, async () => {
    const { platform, call } = await connect({ elicit: action });
    const result = await call("set_table_number", { tableNumber: "A12" });
    assert.ok(result.isError);
    assert.match(result.text, /nothing was sent/);
    assert.ok(!platform.calls.includes("teams.setTableNumber"));
  });
}

test("refuses writes when the client can't ask for confirmation", async () => {
  const { platform, call } = await connect({ elicit: null });
  const result = await call("submit_project", { projectId: 7, updatedAt: "u1" });
  assert.ok(result.isError);
  assert.match(result.text, /elicitation/);
  assert.ok(!platform.calls.includes("project.createProjectSubmission"));
});

test("serves repeated reads from the cache", async () => {
  const { platform, call } = await connect();
  const first = await call("list_my_events");
  assert.equal(first.json()[0].name, "Junction 2026");
  await call("list_my_events");
  await call("get_schedule");
  assert.equal(platform.requests, 1);
});

test("defaults to the only registered event", async () => {
  const { platform, call } = await connect();
  const announcements = (await call("get_announcements")).json();
  assert.deepEqual(
    announcements.map((a: { title: string }) => a.title),
    ["New", "Old"],
  );
  assert.deepEqual(platform.inputs.get("event.getEventAnnouncements"), [{ eventId: 7 }]);
});

test("sorts the schedule chronologically", async () => {
  const { call } = await connect();
  const { schedule } = (await call("get_schedule")).json();
  assert.deepEqual(
    schedule.map((s: { name: string }) => s.name),
    ["Opening ceremony", "Submissions close"],
  );
});

test("get_challenge finds main and side challenges", async () => {
  const { call } = await connect();
  assert.equal((await call("get_challenge", { challengeId: 298 })).json().kind, "main");
  assert.equal((await call("get_challenge", { challengeId: 29 })).json().kind, "side");
  const missing = await call("get_challenge", { challengeId: 1 });
  assert.ok(missing.isError);
});

test("get_my_team leaves out teammates' email addresses", async () => {
  const { call } = await connect();
  const result = await call("get_my_team");
  assert.ok(!result.text.includes("ada@example.com"));
  const { members, interestedIn } = result.json();
  assert.deepEqual(members, [{ userId: 1, name: "Ada", role: "lead" }]);
  assert.deepEqual(interestedIn, [{ challengeId: 298, name: "Internet Butler" }]);
});

test("get_my_projects joins links, side challenges and submission state", async () => {
  const { call } = await connect();
  const [project] = (await call("get_my_projects")).json();
  assert.equal(project.name, "Jeeves");
  assert.deepEqual(project.sideChallengeIds, [29]);
  assert.equal(project.submitted, false);
  assert.equal(project.links[0].link, "https://example.com");
});

test("stops all traffic after a Vercel checkpoint", async () => {
  const { platform, call } = await connect();
  platform.challenge();
  const blocked = await call("list_my_events");
  assert.ok(blocked.isError);
  assert.match(blocked.text, /Security Checkpoint/);

  const requestsAfterBlock = platform.requests;
  const again = await call("get_announcements", { eventId: 7 });
  assert.ok(again.isError);
  assert.match(again.text, /Paused all requests/);
  assert.equal(platform.requests, requestsAfterBlock);
});

test("explains missing auth", async () => {
  const { call } = await connect({
    handlers: {
      ...handlers,
      "event.getMyEvents": () => {
        throw new FakeTrpcError("UNAUTHORIZED", 401);
      },
    },
  });
  const result = await call("list_my_events");
  assert.ok(result.isError);
  assert.match(result.text, /JUNCTION_CLERK_CLIENT/);
});

test("save_project_draft refuses an update without baseUpdatedAt", async () => {
  const { platform, call, prompts } = await connect();
  const draft = {
    projectId: 7,
    name: "Jeeves",
    punchline: "Your butler",
    description: "…",
    challengeId: 298,
    sideChallengeIds: [],
    links: [],
  };
  const result = await call("save_project_draft", draft);
  assert.ok(result.isError);
  assert.match(result.text, /baseUpdatedAt/);
  assert.ok(!platform.calls.includes("project.saveProjectSubmission"));
  assert.equal(prompts.length, 0, "doesn't ask to confirm an edit that can't be sent");

  const saved = await call("save_project_draft", { ...draft, baseUpdatedAt: "u1" });
  assert.deepEqual(saved.json(), { projectId: 7, updatedAt: "u2" });
  assert.deepEqual(platform.inputs.get("project.saveProjectSubmission"), [
    {
      mode: "update",
      projectId: 7,
      baseUpdatedAt: "u1",
      name: "Jeeves",
      punchline: "Your butler",
      description: "…",
      challenge_id: 298,
      links: [],
      tech_challenge_ids: [],
    },
  ]);
});

test("writes clear the cache", async () => {
  const { platform, call } = await connect();
  await call("get_my_projects");
  assert.ok(!(await call("set_table_number", { tableNumber: "A12" })).isError);
  const before = platform.calls.filter((c) => c === "project.getTeamProjects").length;
  await call("get_my_projects");
  assert.equal(platform.calls.filter((c) => c === "project.getTeamProjects").length, before + 1);
});
