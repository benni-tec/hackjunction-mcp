import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import type { JunctionClient } from "./api/client.ts";
import { PlatformBlockedError } from "./api/guard.ts";
import { LinkType } from "./api/dto.ts";
import { TtlCache } from "./cache.ts";

const MINUTE = 60_000;
/** How long each kind of data is served from the cache. Long TTLs keep request volume low. */
const TTL = {
  events: 10 * MINUTE,
  challenges: 30 * MINUTE,
  announcements: 2 * MINUTE,
  team: 1 * MINUTE,
  teamList: 10 * MINUTE,
  projects: 30_000,
};
const MAX_TEAM_RESULTS = 50;
/** How long a write waits for the user to answer its confirmation prompt. */
const CONFIRM_TIMEOUT_MS = 10 * MINUTE;
const DESCRIPTION_PREVIEW = 300;

export interface JunctionServerOptions {
  api: JunctionClient;
  /**
   * Registers the tools that change data on the platform (project drafts, submissions, team details).
   * Each call asks the user to confirm through MCP elicitation first. Defaults to true.
   */
  allowWrites?: boolean;
  now?: () => number;
}

const eventIdArg = z
  .number()
  .int()
  .optional()
  .describe("Junction event id. Defaults to your only registered event.");

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export function createJunctionServer({ api, allowWrites = true, now }: JunctionServerOptions): McpServer {
  const server = new McpServer(
    { name: "junction", version: "0.1.0" },
    {
      instructions:
        "Participant tools for the Junction hackathon platform (hackjunction.app). " +
        "The platform blocks bursty traffic, so prefer one well-chosen call over many. Results are cached briefly. " +
        "If a tool reports a Security Checkpoint or rate limit, stop calling tools and tell the user. " +
        "Tools that change data ask the user to confirm each change; if they decline, don't retry it.",
    },
  );
  const cache = new TtlCache(now);

  const myEvents = () => cache.get("event.getMyEvents", TTL.events, () => api.event.getMyEvents.query());

  async function resolveEventId(eventId: number | undefined): Promise<number> {
    if (eventId !== undefined) return eventId;
    const events = await myEvents();
    if (events.length === 1) return events[0]!.id;
    if (events.length === 0) throw new Error("You aren't registered to any Junction event");
    throw new Error(
      `You're registered to ${events.length} events; pass eventId: ${events.map((e) => `${e.id} (${e.name})`).join(", ")}`,
    );
  }

  const challenges = (eventId: number) =>
    cache.get(`challenges:${eventId}`, TTL.challenges, async () => {
      const [main, side] = await Promise.all([
        api.event.getEventChallenges.query({ eventId }),
        api.event.getEventSideChallenges.query({ eventId }),
      ]);
      return { main, side };
    });

  const myTeam = (eventId: number) =>
    cache.get(`team:${eventId}`, TTL.team, () => api.teams.getMyTeam.query({ eventId }));

  async function requireTeam(eventId: number) {
    const team = await myTeam(eventId);
    if (!team) throw new Error(`You're not in a team for event ${eventId}`);
    return team;
  }

  async function challengeNames(eventId: number, ids: number[]): Promise<string> {
    if (ids.length === 0) return "none";
    const { main, side } = await challenges(eventId);
    const all = [...main, ...side];
    return ids.map((id) => all.find((c) => c.id === id)?.name ?? `#${id}`).join(", ");
  }

  /**
   * Asks the user to approve a change through MCP elicitation. Fails closed: nothing is sent unless they accept,
   * and clients that can't ask don't get to write at all.
   */
  async function confirm(message: string): Promise<void> {
    if (!server.server.getClientCapabilities()?.elicitation?.form) {
      throw new Error(
        "This MCP client can't ask you to confirm changes (no elicitation support), so nothing was sent. " +
          "Make the change on hackjunction.app instead.",
      );
    }
    const { action } = await server.server.elicitInput(
      { message, requestedSchema: { type: "object", properties: {} } },
      { timeout: CONFIRM_TIMEOUT_MS },
    );
    if (action !== "accept") {
      throw new Error(`The user ${action === "decline" ? "declined" : "cancelled"} this change; nothing was sent.`);
    }
  }

  const read = <A>(handler: (args: A) => Promise<unknown>) => guarded(handler);
  const write = <A>(handler: (args: A) => Promise<unknown>) =>
    guarded(async (args: A) => {
      try {
        return await handler(args);
      } finally {
        cache.clear();
      }
    });

  server.registerTool(
    "list_my_events",
    {
      title: "My Junction events",
      description: "Events you're registered to, with their key dates and your registration status.",
      annotations: readOnly,
    },
    read(async () =>
      (await myEvents()).map((e) => ({
        id: e.id,
        name: e.name,
        registrationStatus: e.userRegistrationStatus,
        startTime: e.startTime,
        endTime: e.endTime,
        submissionsStartTime: e.submissionsStartTime,
        submissionsEndTime: e.submissionsEndTime,
        displayTimezone: e.displayTimezone,
        maxTeamSize: e.maxTeamSize,
        allowMultipleSubmissions: e.allowMultipleSubmissions,
        participantCount: e.participantCount,
        discordLink: e.discordLink,
        faqLink: e.faqLink,
      })),
    ),
  );

  server.registerTool(
    "get_schedule",
    {
      title: "Event schedule",
      description: "The event's schedule, in chronological order.",
      inputSchema: { eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ eventId }: { eventId?: number }) => {
      const id = await resolveEventId(eventId);
      const event = (await myEvents()).find((e) => e.id === id);
      if (!event) throw new Error(`You aren't registered to event ${id}`);
      return {
        displayTimezone: event.displayTimezone,
        schedule: [...event.schedule]
          .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
          .map(({ name, datetime }) => ({ name, datetime })),
      };
    }),
  );

  server.registerTool(
    "get_announcements",
    {
      title: "Announcements",
      description: "The organisers' announcements for the event, newest first.",
      inputSchema: { eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ eventId }: { eventId?: number }) => {
      const id = await resolveEventId(eventId);
      const announcements = await cache.get(`announcements:${id}`, TTL.announcements, () =>
        api.event.getEventAnnouncements.query({ eventId: id }),
      );
      return [...announcements]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ title, content, createdAt }) => ({ title, content, createdAt }));
    }),
  );

  server.registerTool(
    "list_challenges",
    {
      title: "Challenges",
      description:
        "The event's main challenges (a project picks one) and side/tech challenges (a project can add several). " +
        "Use get_challenge for the full brief.",
      inputSchema: { eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ eventId }: { eventId?: number }) => {
      const { main, side } = await challenges(await resolveEventId(eventId));
      return {
        challenges: main.map(({ id, name, trackId }) => ({ id, name, trackId })),
        sideChallenges: side.map(({ id, name, trackId }) => ({ id, name, trackId })),
      };
    }),
  );

  server.registerTool(
    "get_challenge",
    {
      title: "Challenge brief",
      description: "A challenge's full brief: description, insights and resources (markdown).",
      inputSchema: { challengeId: z.number().int(), eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ challengeId, eventId }: { challengeId: number; eventId?: number }) => {
      const { main, side } = await challenges(await resolveEventId(eventId));
      const pick = ({ id, name, description, insights, resources, image }: (typeof main)[number] | (typeof side)[number]) =>
        ({ id, name, description, insights, resources, image });
      const challenge = main.find((c) => c.id === challengeId);
      if (challenge) return { kind: "main", ...pick(challenge) };
      const sideChallenge = side.find((c) => c.id === challengeId);
      if (sideChallenge) return { kind: "side", ...pick(sideChallenge) };
      throw new Error(`No challenge ${challengeId} in this event; see list_challenges`);
    }),
  );

  server.registerTool(
    "get_my_team",
    {
      title: "My team",
      description: "Your team's details, members (names and roles only) and the challenges it's interested in.",
      inputSchema: { eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ eventId }: { eventId?: number }) => {
      const id = await resolveEventId(eventId);
      const team = await myTeam(id);
      if (!team) return { team: null };
      const [members, interests, { main }] = await cache.get(`teamDetails:${team.id}`, TTL.team, () =>
        Promise.all([
          api.teams.getMyTeamMembers.query({ teamId: team.id, eventId: id }),
          api.teams.getTeamInterests.query({ teamId: team.id, eventId: id }),
          challenges(id),
        ]),
      );
      return {
        team,
        members: members.map(({ userId, name, role }) => ({ userId, name, role })),
        interestedIn: interests.map(({ challengeId }) => ({
          challengeId,
          name: main.find((c) => c.id === challengeId)?.name,
        })),
      };
    }),
  );

  server.registerTool(
    "list_teams",
    {
      title: "Teams",
      description: `Teams in the event, optionally filtered by name. Returns at most ${MAX_TEAM_RESULTS}.`,
      inputSchema: {
        nameContains: z.string().optional().describe("Case-insensitive filter on the team name and subtitle"),
        eventId: eventIdArg,
      },
      annotations: readOnly,
    },
    read(async ({ nameContains, eventId }: { nameContains?: string; eventId?: number }) => {
      const id = await resolveEventId(eventId);
      const teams = await cache.get(`teams:${id}`, TTL.teamList, () => api.teams.listEventTeams.query({ eventId: id }));
      const needle = nameContains?.toLowerCase();
      const matches = needle
        ? teams.filter((t) => `${t.name} ${t.subtitle}`.toLowerCase().includes(needle))
        : teams;
      return {
        total: matches.length,
        teams: matches
          .slice(0, MAX_TEAM_RESULTS)
          .map(({ id, name, subtitle, memberCount, memberFirstNames }) => ({ id, name, subtitle, memberCount, memberFirstNames })),
      };
    }),
  );

  server.registerTool(
    "get_my_projects",
    {
      title: "My team's projects",
      description:
        "Your team's projects with their links, side challenges and whether they've been submitted. " +
        "Pass a project's updatedAt to save_project_draft and submit_project.",
      inputSchema: { eventId: eventIdArg },
      annotations: readOnly,
    },
    read(async ({ eventId }: { eventId?: number }) => {
      const id = await resolveEventId(eventId);
      const team = await requireTeam(id);
      return cache.get(`projects:${team.id}`, TTL.projects, async () => {
        const projects = await api.project.getTeamProjects.query({ teamId: team.id, eventId: id });
        return Promise.all(
          projects.map(async (project) => {
            const [links, sideChallenges, submission] = await Promise.all([
              api.project.getProjectLinks.query({ projectId: project.id }),
              api.project.getProjectSideChallenges.query({ projectId: project.id }),
              api.project.getProjectSubmission.query({ projectId: project.id }),
            ]);
            return {
              ...project,
              links,
              sideChallengeIds: sideChallenges.map((s) => s.sideChallengeId),
              submitted: Boolean(submission),
            };
          }),
        );
      });
    }),
  );

  if (allowWrites) registerWriteTools();

  return server;

  function registerWriteTools() {
    server.registerTool(
      "save_project_draft",
      {
        title: "Save project draft",
        description:
          "Creates or updates your team's project draft, like the website's project form: send every field, " +
          "because links and sideChallengeIds replace the saved ones. Leave projectId out to create a project. " +
          "To update, pass projectId and baseUpdatedAt (the updatedAt from get_my_projects), so you can't overwrite " +
          "a teammate's newer edit. Saving does not submit the project; use submit_project for that. " +
          "Asks the user to confirm before saving.",
        inputSchema: {
          eventId: eventIdArg,
          projectId: z.number().int().optional(),
          baseUpdatedAt: z.string().optional(),
          name: z.string().max(30),
          punchline: z.string().max(200),
          description: z.string().max(5000).describe("Markdown"),
          challengeId: z.number().int().describe("The main challenge; one project per challenge per team"),
          sideChallengeIds: z.array(z.number().int()),
          links: z.array(z.object({ type: LinkType, url: z.string().url() })),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      write(
        async (args: {
          eventId?: number;
          projectId?: number;
          baseUpdatedAt?: string;
          name: string;
          punchline: string;
          description: string;
          challengeId: number;
          sideChallengeIds: number[];
          links: { type: z.infer<typeof LinkType>; url: string }[];
        }) => {
          const fields = {
            name: args.name,
            punchline: args.punchline,
            description: args.description,
            challenge_id: args.challengeId,
            links: args.links.map(({ type, url }) => ({ type, value: url })),
            tech_challenge_ids: args.sideChallengeIds,
          };
          const creating = args.projectId === undefined;
          if (!creating && !args.baseUpdatedAt) {
            throw new Error("Pass baseUpdatedAt (the project's updatedAt from get_my_projects) to update a project");
          }
          const eventId = await resolveEventId(args.eventId);
          const preview =
            args.description.length > DESCRIPTION_PREVIEW
              ? `${args.description.slice(0, DESCRIPTION_PREVIEW)}… (${args.description.length} characters)`
              : args.description;
          await confirm(
            [
              creating ? "Create a new project draft?" : `Save changes to project ${args.projectId}'s draft?`,
              `Name: ${args.name}`,
              `Punchline: ${args.punchline}`,
              `Challenge: ${await challengeNames(eventId, [args.challengeId])}`,
              `Side challenges: ${await challengeNames(eventId, args.sideChallengeIds)}`,
              `Links: ${args.links.map(({ type, url }) => `${type} ${url}`).join(", ") || "none"}`,
              `Description: ${preview}`,
            ].join("\n"),
          );
          if (creating) {
            return api.project.saveProjectSubmission.mutate({ mode: "create", eventId, ...fields });
          }
          return api.project.saveProjectSubmission.mutate({
            mode: "update",
            projectId: args.projectId!,
            baseUpdatedAt: args.baseUpdatedAt!,
            ...fields,
          });
        },
      ),
    );

    server.registerTool(
      "submit_project",
      {
        title: "Submit project",
        description:
          "Submits a saved draft as your team's final entry. Name, punchline, description and challenge must be filled " +
          "in, and the submission window must be open. Asks the user to confirm before submitting.",
        inputSchema: {
          projectId: z.number().int(),
          updatedAt: z.string().describe("The project's updatedAt from get_my_projects or save_project_draft"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      write(async ({ projectId, updatedAt }: { projectId: number; updatedAt: string }) => {
        await confirm(`Submit project ${projectId} as your team's final entry?`);
        return api.project.createProjectSubmission.mutate({ projectId, updatedAt });
      }),
    );

    server.registerTool(
      "unsubmit_project",
      {
        title: "Unsubmit project",
        description: "Withdraws a submitted project back to draft. Asks the user to confirm first.",
        inputSchema: { projectId: z.number().int() },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      write(async ({ projectId }: { projectId: number }) => {
        await confirm(`Withdraw project ${projectId}'s submission? It goes back to being a draft.`);
        return api.project.deleteProjectSubmission.mutate({ projectId });
      }),
    );

    server.registerTool(
      "edit_team",
      {
        title: "Edit team",
        description: "Updates your team's name, subtitle, description and contact. Send every field.",
        inputSchema: {
          eventId: eventIdArg,
          name: z.string(),
          subtitle: z.string(),
          description: z.string(),
          contact: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      write(
        async ({ eventId, ...details }: { eventId?: number; name: string; subtitle: string; description: string; contact: string }) => {
          const id = await resolveEventId(eventId);
          const team = await requireTeam(id);
          await confirm(
            [
              `Update team "${team.name}"?`,
              `Name: ${details.name}`,
              `Subtitle: ${details.subtitle}`,
              `Description: ${details.description}`,
              `Contact: ${details.contact}`,
            ].join("\n"),
          );
          return api.teams.editTeam.mutate({ teamId: team.id, eventId: id, ...details });
        },
      ),
    );

    server.registerTool(
      "set_table_number",
      {
        title: "Set table number",
        description: "Sets the table your team sits at (e.g. `A12`), or clears it with null.",
        inputSchema: { eventId: eventIdArg, tableNumber: z.string().max(32).nullable() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      write(async ({ eventId, tableNumber }: { eventId?: number; tableNumber: string | null }) => {
        const id = await resolveEventId(eventId);
        const team = await requireTeam(id);
        await confirm(
          tableNumber === null
            ? `Clear team "${team.name}"'s table number?`
            : `Set team "${team.name}"'s table number to ${tableNumber}?`,
        );
        return api.teams.setTableNumber.mutate({ teamId: team.id, eventId: id, tableNumber });
      }),
    );

    server.registerTool(
      "set_team_interests",
      {
        title: "Set team challenge interests",
        description: "Replaces the full set of main challenges your team is interested in.",
        inputSchema: { eventId: eventIdArg, challengeIds: z.array(z.number().int()) },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      write(async ({ eventId, challengeIds }: { eventId?: number; challengeIds: number[] }) => {
        const id = await resolveEventId(eventId);
        const team = await requireTeam(id);
        await confirm(
          `Replace team "${team.name}"'s challenge interests with: ${await challengeNames(id, challengeIds)}?`,
        );
        return api.teams.setTeamInterests.mutate({ teamId: team.id, eventId: id, challengeIds });
      }),
    );
  }
}

/** Runs a tool handler, returning its result as JSON text and failures as readable tool errors. */
function guarded<A>(handler: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const result = await handler(args);
      return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: describeError(error) }] };
    }
  };
}

export function describeError(error: unknown): string {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e instanceof PlatformBlockedError) return e.message;
  }
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | undefined)?.code;
    if (code === "UNAUTHORIZED") {
      return "Not signed in to hackjunction.app (UNAUTHORIZED). Set JUNCTION_CLERK_CLIENT and JUNCTION_CLERK_SESSION.";
    }
    if (code === "CONFLICT") {
      return "Someone saved this project after you read it (CONFLICT). Call get_my_projects and redo the edit on the latest version.";
    }
    return code ? `Junction API error ${code}: ${error.message}` : `Junction API error: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
