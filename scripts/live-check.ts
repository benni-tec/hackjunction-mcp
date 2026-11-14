/**
 * LIVE check against the real platform: calls every read-only procedure through the typed client and validates the
 * responses against the DTOs. Prints pass/fail and schema issues only, never response data.
 * A person has to confirm at an interactive terminal before anything is sent (see confirm-live.ts).
 *
 *   JUNCTION_CLERK_CLIENT=<__client cookie> JUNCTION_CLERK_SESSION=<sess_…> npm run test:live
 *
 * `JUNCTION_TOKEN=<session JWT>` works too, but the token lives only 60 s.
 */
import { z } from "zod";
import { createJunctionClient } from "../src/api/client.ts";
import * as dto from "../src/api/dto.ts";
import { PlatformBlockedError, createGuardedFetch } from "../src/api/guard.ts";
import { tokenProviderFromEnv } from "../src/config.ts";
import { confirmLive } from "./confirm-live.ts";

await confirmLive("~20 read-only requests to https://hackjunction.app, 1.5 s apart (about 30 s)");

const { mode, getToken } = tokenProviderFromEnv(process.env, createGuardedFetch({ minIntervalMs: 1_500 }));
if (mode === "none") {
  console.error("Set JUNCTION_CLERK_CLIENT and JUNCTION_CLERK_SESSION (or JUNCTION_TOKEN)");
  process.exit(1);
}

const api = createJunctionClient({ getToken, fetch: createGuardedFetch({ minIntervalMs: 1_500 }) });
let failures = 0;

async function check<T>(name: string, schema: z.ZodType<T>, call: () => Promise<unknown>): Promise<T | undefined> {
  try {
    const result = schema.safeParse(await call());
    if (result.success) {
      console.log(`ok    ${name}`);
      return result.data;
    }
    failures++;
    console.log(`DRIFT ${name}`);
    for (const issue of result.error.issues.slice(0, 5)) {
      console.log(`        ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  } catch (error) {
    if (error instanceof Error && error.cause instanceof PlatformBlockedError) {
      console.log(`STOP  ${name}: ${error.cause.message}`);
      process.exit(3);
    }
    failures++;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const myEvents = await check("event.getMyEvents", z.array(dto.MyEvent), () => api.event.getMyEvents.query());
await check("event.getAllFutureEvents", z.array(dto.Event), () => api.event.getAllFutureEvents.query());
await check("event.getAllPastEvents", z.array(dto.Event), () => api.event.getAllPastEvents.query());
await check("event.getAllFeaturedEvents", z.array(dto.Event), () => api.event.getAllFeaturedEvents.query());
await check("user.getConsentToShareInfo", z.boolean(), () => api.user.getConsentToShareInfo.query());
await check("skill.getUserSkills", z.array(dto.UserSkill), () => api.skill.getUserSkills.query());

const event = myEvents?.[0];
if (!event) {
  console.log("skip  event/team/project/registration procedures: not registered to any event");
} else {
  const eventId = event.id;
  const registrationId = event.userRegistrationId;
  await check("event.getEventAnnouncements", z.array(dto.Announcement), () =>
    api.event.getEventAnnouncements.query({ eventId }),
  );
  await check("event.getEventChallenges", z.array(dto.Challenge), () => api.event.getEventChallenges.query({ eventId }));
  await check("event.getEventSideChallenges", z.array(dto.SideChallenge), () =>
    api.event.getEventSideChallenges.query({ eventId }),
  );
  await check("teams.listEventTeams", z.array(dto.TeamListing), () => api.teams.listEventTeams.query({ eventId }));
  await check("teams.eventMaxTeamSize", z.array(z.object({ maxTeamSize: z.number() })), () =>
    api.teams.eventMaxTeamSize.query({ eventId }),
  );
  await check("teams.getEventChallenges", z.array(dto.Challenge), () => api.teams.getEventChallenges.query({ eventId }));
  await check("registration.getRegistrationQuestions", z.array(dto.RegistrationQuestion), () =>
    api.registration.getRegistrationQuestions.query({ eventId }),
  );
  await check("registration.getRegistrationAnswers", z.array(dto.RegistrationAnswer), () =>
    api.registration.getRegistrationAnswers.query({ registrationId }),
  );
  await check("registration.getUserDataFromRegistration", dto.RegistrationUserData, () =>
    api.registration.getUserDataFromRegistration.query({ registrationId }),
  );
  await check("registration.getUserConsent", z.boolean(), () =>
    api.registration.getUserConsent.query({ registrationId }),
  );

  const team = await check("teams.getMyTeam", dto.MyTeam.nullable(), () => api.teams.getMyTeam.query({ eventId }));
  if (!team) {
    console.log("skip  team/project procedures: no team");
  } else {
    const teamId = team.id;
    await check("teams.getMyTeamMembers", z.array(dto.TeamMember), () =>
      api.teams.getMyTeamMembers.query({ teamId, eventId }),
    );
    await check("teams.getTeam", dto.Team, () => api.teams.getTeam.query({ teamId, eventId }));
    await check("teams.getTeamInterests", z.array(dto.TeamInterest), () =>
      api.teams.getTeamInterests.query({ teamId, eventId }),
    );
    await check("project.getTeamProject", dto.Project.nullable(), () =>
      api.project.getTeamProject.query({ teamId, eventId }),
    );
    const projects = await check("project.getTeamProjects", z.array(dto.Project), () =>
      api.project.getTeamProjects.query({ teamId, eventId }),
    );
    const projectId = projects?.[0]?.id;
    if (projectId === undefined) {
      console.log("skip  project.getProjectLinks/getProjectSideChallenges/getProjectSubmission: no project");
    } else {
      await check("project.getProjectLinks", z.array(dto.ProjectLink), () =>
        api.project.getProjectLinks.query({ projectId }),
      );
      await check("project.getProjectSideChallenges", z.array(dto.ProjectSideChallenge), () =>
        api.project.getProjectSideChallenges.query({ projectId }),
      );
      await check("project.getProjectSubmission", z.unknown(), () =>
        api.project.getProjectSubmission.query({ projectId }),
      );
    }
  }
}

process.exit(failures ? 1 : 0);
