# Junction Platform API map

Reverse-engineered from the live participant frontend at https://hackjunction.app.
The live platform is a Next.js App Router rewrite and is **not** the open-source
`hackjunction/JunctionApp` (Express + Auth0) codebase.

## Transport

- tRPC over HTTP with the superjson transformer, at `https://hackjunction.app/api/trpc/<router>.<procedure>`.
- Queries: `GET /api/trpc/a.b,c.d?batch=1&input=<urlencoded JSON>`, where input is `{"0":{"json":<input>},"1":{...}}`.
  When there's no input, send `{"0":{"json":null,"meta":{"values":["undefined"]}}}`.
- Mutations: `POST /api/trpc/a.b?batch=1` with body `{"0":{"json":<input>}}`.
- Responses: `[{"result":{"data":{"json":...}}}]`, or `[{"error":{"json":{"message","code","data":{"code","httpStatus","path"}}}}]`.
  Zod validation failures come back as `BAD_REQUEST` with the Zod issues JSON-encoded in `message`.
  The project save uses optimistic concurrency and returns `CONFLICT` when `baseUpdatedAt` is stale.

## Auth

- Clerk, with the frontend API at `https://clerk.hackjunction.app` and publishable key `pk_live_Y2xlcmsuaGFja2p1bmN0aW9uLmFwcCQ`.
- `Authorization: Bearer <Clerk session JWT>` works without cookies. A request with no auth gets `401 UNAUTHORIZED`.
- The session JWT lives **60 s** (claims: `azp, exp, fva, iat, iss, nbf, sid, sts, sub, v`). Mint fresh ones from the
  long-lived Clerk client with `POST https://clerk.hackjunction.app/v1/client/sessions/{sid}/tokens`.
- Enabled sign-in factors: `email_code`, `password`, `oauth_google`. `single_session_mode` is on.
  Email code lets a non-browser client sign in through the Clerk FAPI
  (`/v1/client/sign_ins` → `prepare_first_factor` → `attempt_first_factor`).

## Procedures

Legend: **Q** = query (GET), **M** = mutation (POST). Inputs come from client call sites; outputs from live calls.

### event
| Proc | Kind | Input | Output / notes |
|---|---|---|---|
| `event.getMyEvents` | Q | – | Events you're registered for. Full event object, plus `schedule[] {id,name,datetime,weight}`, `participantCount`, `userRegistrationId`, `userRegistrationStatus` (e.g. `checked-in`), `isPartnerEvent`/`isVolunteerEvent`/`isJudgeEvent` |
| `event.getAllFutureEvents` | Q | – | Public event objects (no schedule) |
| `event.getAllPastEvents` | Q | – | " |
| `event.getAllFeaturedEvents` | Q | – | " |
| `event.getEventAnnouncements` | Q | `{eventId}` | `[{id,eventId,title,content,createdAt,updatedAt}]` |
| `event.getEventChallenges` | Q | `{eventId}` | `[{id,eventId,name,description,insights,resources,image,trackId,challengeProviderOrganizationId}]` (markdown) |
| `event.getEventSideChallenges` | Q | `{eventId}` | Tech/side challenges: `[{id,trackId,name,description,insights,resources,sideChallengeProviderOrganizationId}]` |

Useful event fields: `startTime`, `endTime`, `submissionsStartTime`, `submissionsEndTime`, `maxTeamSize`,
`allowMultipleSubmissions`, `physicalPeerReview`, `currentPeerReviewRound`, `displayTimezone`, `discordLink`, `faqLink`.

### teams
| Proc | Kind | Input | Output / notes |
|---|---|---|---|
| `teams.getMyTeam` | Q | `{eventId}` | `{id,name,subtitle,description,contact,joinCode,tableNumber,peerReviewRound,role: "lead"\|"member"}` or null |
| `teams.getMyTeamMembers` | Q | `{teamId,eventId}` | `[{userId,externalUserId,role,name,imageUrl,emailAddresses[]}]` ⚠ includes teammates' emails |
| `teams.getTeam` | Q | `{teamId,eventId}` | Team row |
| `teams.listEventTeams` | Q | `{eventId}` | All teams: `[{id,name,subtitle,memberCount,memberFirstNames[]}]` (519 for Junction 2026) |
| `teams.eventMaxTeamSize` | Q | `{eventId}` | `[{maxTeamSize}]` |
| `teams.getTeamInterests` | Q | `{teamId,eventId}` | `[{challengeId,...}]` |
| `teams.getEventChallenges` | Q | `{eventId}` | Same as `event.getEventChallenges` |
| `teams.createTeam` | M | `{eventId,name,subtitle,description,contact}` | Blocked after `submissionsEndTime` (old backend did this; assume still true) |
| `teams.editTeam` | M | `{teamId,eventId,name,subtitle,description,contact}` | |
| `teams.deleteTeam` | M | `{teamId,eventId}` | Lead only |
| `teams.joinTeam` | M | `{eventId,joinCode}` | joinCode 1–256 chars |
| `teams.leaveTeam` | M | `{teamId,eventId}` | |
| `teams.kickTeamMember` | M | `{teamId,eventId,userId}` | Lead only |
| `teams.regenerateJoinCode` | M | `{teamId,eventId}` | |
| `teams.setTableNumber` | M | `{teamId,eventId,tableNumber: string\|null}` | ≤32 chars, e.g. `A12` |
| `teams.setTeamInterests` | M | `{teamId,eventId,challengeIds:number[]}` | Replaces the full set; lead only in UI |

### project
| Proc | Kind | Input | Output / notes |
|---|---|---|---|
| `project.getTeamProject` | Q | `{teamId,eventId}` | Project row or null |
| `project.getTeamProjects` | Q | `{teamId,eventId}` | `[project]` (event allows multiple submissions). Each row embeds `projectLinks` and `submission` (null for a draft), so the two lookups below aren't needed when listing |
| `project.getProjectLinks` | Q | `{projectId}` | `[{type: demo\|source_code\|video\|other\|presentation, link}]` |
| `project.getProjectSideChallenges` | Q | `{projectId}` | `[{sideChallengeId}]` |
| `project.getProjectSubmission` | Q | `{projectId}` | Truthy if submitted (final), otherwise a draft |
| `project.saveProjectSubmission` | M | see below | Save draft → `{projectId, updatedAt}` |
| `project.createProjectSubmission` | M | `{projectId, updatedAt}` | Mark draft as submitted |
| `project.deleteProjectSubmission` | M | `{projectId}` | Un-submit, back to draft |
| `project.getPresentationPresignedPost` | M | `{projectId\|eventId, uuid, presentationSize, fileType}` | Presigned URL; client `PUT`s the file, final URL `https://files.hackjunction.app/presentations/<eventId>/<uuid>.<ext>` |
| `project.getPresentationPresignedDelete` | M | `{projectId, presentationUrl}` | Presigned URL for `DELETE` |

`saveProjectSubmission` input:
```jsonc
{
  "mode": "create" | "update",
  "eventId": 7,             // when mode=create
  "projectId": 123,         // when mode=update
  "name": "…",              // ≤30 chars
  "punchline": "…",         // ≤200
  "description": "…",       // ≤5000, markdown
  "challenge_id": 298,      // required; one project per challenge per team
  "baseUpdatedAt": "…",     // updatedAt of the version being edited → CONFLICT if stale
  "links": [{ "type": "demo" | "source_code" | "video" | "other" | "presentation", "value": "https://…" }],
  "tech_challenge_ids": [29]
}
```
Submitting requires name, punchline, description and challenge to be filled in. The window is `submissionsStartTime`–`submissionsEndTime`.

### registration
| Proc | Kind | Input | Notes |
|---|---|---|---|
| `registration.getRegistrationQuestions` | Q | `{eventId}` | |
| `registration.getRegistrationAnswers` | Q | `{registrationId}` | |
| `registration.getUserDataFromRegistration` | Q | `{registrationId}` | |
| `registration.getUserConsent` | Q | `{registrationId}` | |
| `registration.registerWithDynamicForm` | M | `{eventId, answers:[{questionId,answer,section}]}` | |
| `registration.confirm` | M | `{registrationId,eventId}` | Confirm attendance |

### user / skill
| Proc | Kind | Input | Notes |
|---|---|---|---|
| `user.getConsentToShareInfo` | Q | – | boolean |
| `user.giveConsentToShareInfo` / `user.removeConsentToShareInfo` | M | – | |
| `skill.getUserSkills` | Q | – | `[{skillId, skill:{name}}]` |
| `skill.addUserSkill` | M | `{skillName}` | |
| `skill.removeUserSkill` | M | `{skillId}` | |

## Participant pages → data

`/participate/<eventId>` has these pages: dashboard (schedule, announcements, challenge interests), `team`, `ticket`, `guide`, `partners`,
`project`, `submissions`, `peer-review`. The ticket, guide, partners and peer-review pages showed no tRPC calls of their own.
They're rendered on the server or static, so peer review has no API until a review round starts.
