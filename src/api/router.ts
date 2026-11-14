/**
 * Type-only mirror of the Junction platform's tRPC router.
 *
 * The real router lives in Junction's (closed) Next.js app. This stub copies its procedure tree with our DTOs,
 * so `typeof junctionRouter` can type `@trpc/client`. The resolvers never run: import the router as a type only.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import * as dto from "./dto.ts";

const t = initTRPC.create({ transformer: superjson });
const procedure = t.procedure;

const contractOnly = (): never => {
  throw new Error("Contract stub: this procedure is served by hackjunction.app");
};

export const junctionRouter = t.router({
  event: t.router({
    getMyEvents: procedure.output(z.array(dto.MyEvent)).query(contractOnly),
    getAllFutureEvents: procedure.output(z.array(dto.Event)).query(contractOnly),
    getAllPastEvents: procedure.output(z.array(dto.Event)).query(contractOnly),
    getAllFeaturedEvents: procedure.output(z.array(dto.Event)).query(contractOnly),
    getEventAnnouncements: procedure.input(dto.EventInput).output(z.array(dto.Announcement)).query(contractOnly),
    getEventChallenges: procedure.input(dto.EventInput).output(z.array(dto.Challenge)).query(contractOnly),
    getEventSideChallenges: procedure.input(dto.EventInput).output(z.array(dto.SideChallenge)).query(contractOnly),
  }),

  teams: t.router({
    getMyTeam: procedure.input(dto.EventInput).output(dto.MyTeam.nullable()).query(contractOnly),
    /** Includes teammates' email addresses. */
    getMyTeamMembers: procedure.input(dto.TeamInput).output(z.array(dto.TeamMember)).query(contractOnly),
    getTeam: procedure.input(dto.TeamInput).output(dto.Team).query(contractOnly),
    listEventTeams: procedure.input(dto.EventInput).output(z.array(dto.TeamListing)).query(contractOnly),
    eventMaxTeamSize: procedure
      .input(dto.EventInput)
      .output(z.array(z.object({ maxTeamSize: z.number().int() })))
      .query(contractOnly),
    getTeamInterests: procedure.input(dto.TeamInput).output(z.array(dto.TeamInterest)).query(contractOnly),
    /** Same data as `event.getEventChallenges`. */
    getEventChallenges: procedure.input(dto.EventInput).output(z.array(dto.Challenge)).query(contractOnly),

    createTeam: procedure.input(dto.CreateTeamInput).output(z.unknown()).mutation(contractOnly),
    editTeam: procedure.input(dto.EditTeamInput).output(z.unknown()).mutation(contractOnly),
    deleteTeam: procedure.input(dto.TeamInput).output(z.unknown()).mutation(contractOnly),
    joinTeam: procedure.input(dto.JoinTeamInput).output(z.unknown()).mutation(contractOnly),
    leaveTeam: procedure.input(dto.TeamInput).output(z.unknown()).mutation(contractOnly),
    kickTeamMember: procedure.input(dto.KickTeamMemberInput).output(z.unknown()).mutation(contractOnly),
    regenerateJoinCode: procedure.input(dto.TeamInput).output(z.unknown()).mutation(contractOnly),
    setTableNumber: procedure.input(dto.SetTableNumberInput).output(z.unknown()).mutation(contractOnly),
    setTeamInterests: procedure.input(dto.SetTeamInterestsInput).output(z.unknown()).mutation(contractOnly),
  }),

  project: t.router({
    getTeamProject: procedure.input(dto.TeamInput).output(dto.Project.nullable()).query(contractOnly),
    getTeamProjects: procedure.input(dto.TeamInput).output(z.array(dto.Project)).query(contractOnly),
    getProjectLinks: procedure.input(dto.ProjectInput).output(z.array(dto.ProjectLink)).query(contractOnly),
    getProjectSideChallenges: procedure
      .input(dto.ProjectInput)
      .output(z.array(dto.ProjectSideChallenge))
      .query(contractOnly),
    /** Truthy once the project has been submitted; otherwise it's still a draft. Shape not observed yet. */
    getProjectSubmission: procedure.input(dto.ProjectInput).output(z.unknown()).query(contractOnly),

    saveProjectSubmission: procedure
      .input(dto.SaveProjectSubmissionInput)
      .output(dto.SaveProjectSubmissionOutput)
      .mutation(contractOnly),
    createProjectSubmission: procedure
      .input(dto.CreateProjectSubmissionInput)
      .output(z.unknown())
      .mutation(contractOnly),
    deleteProjectSubmission: procedure.input(dto.ProjectInput).output(z.unknown()).mutation(contractOnly),
    getPresentationPresignedPost: procedure
      .input(dto.PresentationPresignedPostInput)
      .output(z.string())
      .mutation(contractOnly),
    getPresentationPresignedDelete: procedure
      .input(dto.PresentationPresignedDeleteInput)
      .output(z.string())
      .mutation(contractOnly),
  }),

  registration: t.router({
    getRegistrationQuestions: procedure
      .input(dto.EventInput)
      .output(z.array(dto.RegistrationQuestion))
      .query(contractOnly),
    getRegistrationAnswers: procedure
      .input(dto.RegistrationInput)
      .output(z.array(dto.RegistrationAnswer))
      .query(contractOnly),
    getUserDataFromRegistration: procedure
      .input(dto.RegistrationInput)
      .output(dto.RegistrationUserData)
      .query(contractOnly),
    getUserConsent: procedure.input(dto.RegistrationInput).output(z.boolean()).query(contractOnly),

    registerWithDynamicForm: procedure
      .input(dto.RegisterWithDynamicFormInput)
      .output(z.unknown())
      .mutation(contractOnly),
    confirm: procedure.input(dto.ConfirmRegistrationInput).output(z.unknown()).mutation(contractOnly),
  }),

  user: t.router({
    getConsentToShareInfo: procedure.output(z.boolean()).query(contractOnly),
    giveConsentToShareInfo: procedure.output(z.unknown()).mutation(contractOnly),
    removeConsentToShareInfo: procedure.output(z.unknown()).mutation(contractOnly),
  }),

  skill: t.router({
    getUserSkills: procedure.output(z.array(dto.UserSkill)).query(contractOnly),
    addUserSkill: procedure.input(dto.AddUserSkillInput).output(z.unknown()).mutation(contractOnly),
    removeUserSkill: procedure.input(dto.RemoveUserSkillInput).output(z.unknown()).mutation(contractOnly),
  }),
});

export type JunctionRouter = typeof junctionRouter;
