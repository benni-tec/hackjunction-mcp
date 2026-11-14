/**
 * Request/response DTOs for the Junction platform tRPC API (https://hackjunction.app/api/trpc).
 *
 * Inputs were probed against the server's own Zod validation (mistyped payloads → BAD_REQUEST issues),
 * so their field names, types, enums and required-ness match the server.
 * Outputs were inferred from live responses on 2026-11-13. Fields marked "only null observed" have a guessed type.
 */
import { z } from "zod";

const id = z.number().int();
/** Event timings; sent as superjson Dates, so they arrive as `Date`. */
const isoDateTime = z.date();
/** Postgres timestamp without zone, e.g. `2026-11-13 16:30:35.833443` (createdAt/updatedAt). */
const dbTimestamp = z.string();

// ---------------------------------------------------------------------------
// Shared inputs

export const EventInput = z.object({ eventId: id });
export const TeamInput = z.object({ teamId: id, eventId: id });
export const ProjectInput = z.object({ projectId: id });
export const RegistrationInput = z.object({ registrationId: id });

// ---------------------------------------------------------------------------
// event

export const Event = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  /** Markdown. */
  description: z.string(),
  eventType: z.string(),
  allowMultipleSubmissions: z.boolean(),
  isFeatured: z.boolean(),
  hasGavelVoting: z.boolean(),
  hasFinalistVoting: z.boolean(),
  galleryOpen: z.boolean(),
  maxTeamSize: z.number().int(),
  displayPriority: z.number().int(),
  eventStatus: z.string(),
  approved: z.boolean(),
  meetingsEnabled: z.boolean(),
  showScore: z.boolean(),
  showFeedback: z.boolean(),
  reviewAnyChallenge: z.boolean(),
  physicalPeerReview: z.boolean().nullable(),
  /** Only null observed. */
  currentPeerReviewRound: z.number().int().nullable(),
  displayTimezone: z.string().nullable(),
  coverImage: z.string().nullable(),
  featureBannerImage: z.string().nullable(),
  logo: z.string().nullable(),
  registrationStartTime: isoDateTime,
  registrationEndTime: isoDateTime,
  startTime: isoDateTime,
  submissionsStartTime: isoDateTime,
  submissionsEndTime: isoDateTime,
  reviewingStartTime: isoDateTime.nullable(),
  reviewingEndTime: isoDateTime.nullable(),
  endTime: isoDateTime,
  newsletterLink: z.string().nullable(),
  privacyLink: z.string().nullable(),
  termsLink: z.string().nullable(),
  faqLink: z.string().nullable(),
  gavelBaseUrl: z.string().nullable(),
  gavelAdminToken: z.string().nullable(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
  contactPersonName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  discordLink: z.string().nullable(),
});
export type Event = z.infer<typeof Event>;

export const ScheduleItem = z.object({
  id,
  eventId: id,
  name: z.string(),
  datetime: isoDateTime,
  weight: z.number().int(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type ScheduleItem = z.infer<typeof ScheduleItem>;

/** An event the current user is registered to, as returned by `event.getMyEvents`. */
export const MyEvent = Event.extend({
  schedule: z.array(ScheduleItem),
  participantCount: z.number().int(),
  userRegistrationId: id,
  /** e.g. `checked-in`. */
  userRegistrationStatus: z.string(),
  isPartnerEvent: z.boolean(),
  isVolunteerEvent: z.boolean(),
  isJudgeEvent: z.boolean(),
});
export type MyEvent = z.infer<typeof MyEvent>;

export const Announcement = z.object({
  id,
  eventId: id,
  title: z.string(),
  content: z.string().nullable(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type Announcement = z.infer<typeof Announcement>;

export const Challenge = z.object({
  id,
  eventId: id,
  trackId: id,
  name: z.string(),
  /** Markdown. */
  description: z.string(),
  insights: z.string().nullable(),
  resources: z.string().nullable(),
  image: z.string().nullable(),
  challengeProviderOrganizationId: id,
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type Challenge = z.infer<typeof Challenge>;

/** A "tech challenge" a project can opt into on top of its main challenge. */
export const SideChallenge = z.object({
  id,
  eventId: id,
  trackId: id,
  name: z.string(),
  /** Markdown. */
  description: z.string(),
  insights: z.string().nullable(),
  resources: z.string().nullable(),
  image: z.string().nullable(),
  sideChallengeProviderOrganizationId: id,
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type SideChallenge = z.infer<typeof SideChallenge>;

// ---------------------------------------------------------------------------
// teams

const teamFields = {
  id,
  name: z.string(),
  subtitle: z.string(),
  description: z.string(),
  contact: z.string(),
  joinCode: z.string(),
  tableNumber: z.string().nullable(),
  /** Only null observed. */
  peerReviewRound: z.number().int().nullable(),
};

export const Team = z.object({ ...teamFields, eventId: id, createdAt: dbTimestamp, updatedAt: dbTimestamp });
export type Team = z.infer<typeof Team>;

export const TeamRole = z.enum(["lead", "member"]);
export type TeamRole = z.infer<typeof TeamRole>;

export const MyTeam = z.object({ ...teamFields, role: TeamRole });
export type MyTeam = z.infer<typeof MyTeam>;

/** Clerk EmailAddress resource. */
export const EmailAddress = z.object({
  id: z.string(),
  emailAddress: z.string(),
  verification: z
    .object({
      status: z.string(),
      strategy: z.string(),
      attempts: z.number().int().nullable(),
      expireAt: z.number().int().nullable(),
    })
    .nullable(),
  linkedTo: z.array(z.object({ id: z.string(), type: z.string() })),
});

export const TeamMember = z.object({
  userId: id,
  /** Clerk user id (`user_…`). */
  externalUserId: z.string(),
  role: TeamRole,
  name: z.string(),
  imageUrl: z.string(),
  emailAddresses: z.array(EmailAddress),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamListing = z.object({
  id,
  name: z.string(),
  subtitle: z.string(),
  memberCount: z.number().int(),
  memberFirstNames: z.array(z.string()),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type TeamListing = z.infer<typeof TeamListing>;

export const TeamInterest = z.object({
  id,
  eventId: id,
  teamId: id,
  challengeId: id,
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type TeamInterest = z.infer<typeof TeamInterest>;

const teamDetails = {
  name: z.string(),
  subtitle: z.string(),
  description: z.string(),
  contact: z.string(),
};
export const CreateTeamInput = EventInput.extend(teamDetails);
export const EditTeamInput = TeamInput.extend(teamDetails);
/** The UI limits the join code to 1–256 characters. */
export const JoinTeamInput = EventInput.extend({ joinCode: z.string() });
/** Field name and type come from the client; not probed, because a probe could have kicked a member. */
export const KickTeamMemberInput = TeamInput.extend({ userId: id });
/** The UI limits the table number to 32 characters, e.g. `A12`. */
export const SetTableNumberInput = TeamInput.extend({ tableNumber: z.string().nullable() });
/** Replaces the team's whole interest set. */
export const SetTeamInterestsInput = TeamInput.extend({ challengeIds: z.array(id) });

// ---------------------------------------------------------------------------
// project

export const LinkType = z.enum(["demo", "source_code", "video", "other", "presentation"]);
export type LinkType = z.infer<typeof LinkType>;

/**
 * Observed in `getTeamProjects` on 2026-11-14. It embeds the project's links and submission, so listing projects
 * doesn't need `getProjectLinks` or `getProjectSubmission`. Every project then had no links and no submission,
 * so the shape of those two is still unknown.
 */
export const Project = z.looseObject({
  id,
  teamId: id,
  eventId: id,
  trackId: id.nullable(),
  name: z.string(),
  punchline: z.string().nullable(),
  description: z.string().nullable(),
  challengeId: id.nullable(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
  projectLinks: z.array(z.looseObject({})),
  submission: z.unknown(),
});
export type Project = z.infer<typeof Project>;

/** Not observed yet; fields are those the frontend reads. */
export const ProjectLink = z.looseObject({ type: LinkType, link: z.string() });
export type ProjectLink = z.infer<typeof ProjectLink>;

/** Not observed yet; fields are those the frontend reads. */
export const ProjectSideChallenge = z.looseObject({ sideChallengeId: id });
export type ProjectSideChallenge = z.infer<typeof ProjectSideChallenge>;

const projectFields = {
  /** UI limit: 30 characters. */
  name: z.string(),
  /** UI limit: 200 characters. */
  punchline: z.string(),
  /** Markdown; UI limit: 5000 characters. */
  description: z.string(),
  /** Main challenge. A team can have only one project per challenge. */
  challenge_id: id,
  /** `updatedAt` of the version being edited; the server answers CONFLICT when it's stale. */
  baseUpdatedAt: z.string().optional(),
  links: z.array(z.object({ type: LinkType, value: z.string() })).optional(),
  tech_challenge_ids: z.array(id).optional(),
};

/**
 * The server accepts a flat object with optional `eventId` and `projectId`.
 * This union mirrors how the frontend uses it: `eventId` to create, `projectId` to update.
 */
export const SaveProjectSubmissionInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create"), eventId: id, ...projectFields }),
  z.object({ mode: z.literal("update"), projectId: id, ...projectFields }),
]);
export type SaveProjectSubmissionInput = z.infer<typeof SaveProjectSubmissionInput>;

/** Only the fields the frontend reads. */
export const SaveProjectSubmissionOutput = z.looseObject({ projectId: id, updatedAt: z.string() });

/** Marks a saved draft as the final submission. `updatedAt` comes from the latest save. */
export const CreateProjectSubmissionInput = ProjectInput.extend({ updatedAt: z.string() });

export const PresentationFileType = z.enum(["pdf", "pptx", "ppt", "odp", "key"]);

/**
 * Returns a presigned URL to `PUT` the file to.
 * The file is then served at `https://files.hackjunction.app/presentations/<eventId>/<uuid>.<fileType>`.
 */
export const PresentationPresignedPostInput = z.object({
  projectId: id.optional(),
  eventId: id.optional(),
  uuid: z.string(),
  presentationSize: z.number(),
  fileType: PresentationFileType,
});

/** Returns a presigned URL to `DELETE` the file at. */
export const PresentationPresignedDeleteInput = ProjectInput.extend({ presentationUrl: z.string() });

// ---------------------------------------------------------------------------
// registration

export const RegistrationQuestion = z.object({
  id,
  eventId: id,
  type: z.string(),
  content: z.string(),
  ordering: z.number().int(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).nullable(),
  required: z.boolean(),
  section: z.string(),
  graphicsUrl: z.string().nullable(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type RegistrationQuestion = z.infer<typeof RegistrationQuestion>;

export const RegistrationAnswer = z.object({
  id,
  registrationId: id,
  answerTo: z.string(),
  answer: z.string(),
  section: z.string(),
  createdAt: dbTimestamp,
  updatedAt: dbTimestamp,
});
export type RegistrationAnswer = z.infer<typeof RegistrationAnswer>;

export const RegistrationUserData = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});
export type RegistrationUserData = z.infer<typeof RegistrationUserData>;

export const RegisterWithDynamicFormInput = EventInput.extend({
  answers: z.array(
    z.object({
      questionId: id,
      /** Server-side union; booleans are accepted and numbers are not. The string variants are assumed. */
      answer: z.union([z.string(), z.array(z.string()), z.boolean()]),
      section: z.string(),
    }),
  ),
});

/** Field name and type come from the client; not probed, because a probe could have confirmed attendance. */
export const ConfirmRegistrationInput = RegistrationInput.extend({ eventId: id });

// ---------------------------------------------------------------------------
// skill

/** Not observed yet (empty list); fields are those the frontend reads. */
export const UserSkill = z.looseObject({ skillId: id, skill: z.looseObject({ name: z.string() }) });
export type UserSkill = z.infer<typeof UserSkill>;

export const AddUserSkillInput = z.object({ skillName: z.string() });
export const RemoveUserSkillInput = z.object({ skillId: id });
