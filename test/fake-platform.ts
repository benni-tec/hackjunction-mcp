/**
 * An in-process stand-in for hackjunction.app's tRPC endpoint, so tests never touch the real platform.
 * Speaks the batched httpBatchLink wire format with the superjson transformer.
 */
import superjson from "superjson";

export class FakeTrpcError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus: number, message = code) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type Handler = (input: any) => unknown;

export interface FakePlatform {
  fetch: typeof fetch;
  /** Procedure names in call order. */
  calls: string[];
  /** Inputs by procedure name, latest last. */
  inputs: Map<string, unknown[]>;
  /** HTTP requests made. */
  requests: number;
  /** Make every following request answer like Vercel's Security Checkpoint. */
  challenge(): void;
}

export function fakePlatform(handlers: Record<string, Handler>): FakePlatform {
  let challenged = false;
  const platform: FakePlatform = {
    calls: [],
    inputs: new Map(),
    requests: 0,
    challenge: () => {
      challenged = true;
    },
    fetch: async (input, init) => {
      platform.requests++;
      if (challenged) {
        return new Response("<html>Vercel Security Checkpoint</html>", {
          status: 403,
          headers: { "content-type": "text/html", "x-vercel-mitigated": "challenge" },
        });
      }

      const url = new URL(input instanceof Request ? input.url : String(input));
      const procs = decodeURIComponent(url.pathname.replace(/^\/api\/trpc\//, "")).split(",");
      const rawInputs = JSON.parse(
        init?.method === "POST" ? String(init.body) : (url.searchParams.get("input") ?? "{}"),
      ) as Record<string, { json?: unknown; meta?: unknown }>;

      let status = 200;
      const results = procs.map((proc, i) => {
        const raw = rawInputs[i];
        const procInput = raw && "json" in raw ? superjson.deserialize(raw as never) : undefined;
        platform.calls.push(proc);
        platform.inputs.set(proc, [...(platform.inputs.get(proc) ?? []), procInput]);
        try {
          const handler = handlers[proc];
          if (!handler) throw new FakeTrpcError("NOT_FOUND", 404, `No procedure ${proc}`);
          return { result: { data: superjson.serialize(handler(procInput)) } };
        } catch (error) {
          const { code, httpStatus, message } =
            error instanceof FakeTrpcError ? error : new FakeTrpcError("INTERNAL_SERVER_ERROR", 500, String(error));
          if (status === 200) status = httpStatus;
          return {
            error: superjson.serialize({ message, code: -32000, data: { code, httpStatus, path: proc } }),
          };
        }
      });
      return new Response(JSON.stringify(results), { status, headers: { "content-type": "application/json" } });
    },
  };
  return platform;
}

const at = (iso: string) => new Date(iso);

export const sampleEvent = {
  id: 7,
  name: "Junction 2026",
  slug: "junction-2026",
  description: "",
  maxTeamSize: 5,
  allowMultipleSubmissions: true,
  displayTimezone: "Europe/Helsinki",
  startTime: at("2026-11-13T15:00:00Z"),
  endTime: at("2026-11-15T15:00:00Z"),
  submissionsStartTime: at("2026-11-14T10:00:00Z"),
  submissionsEndTime: at("2026-11-15T08:00:00Z"),
  discordLink: null,
  faqLink: null,
  participantCount: 1500,
  userRegistrationId: 900,
  userRegistrationStatus: "checked-in",
  schedule: [
    { id: 2, eventId: 7, name: "Submissions close", datetime: at("2026-11-15T08:00:00Z"), weight: 0 },
    { id: 1, eventId: 7, name: "Opening ceremony", datetime: at("2026-11-13T16:00:00Z"), weight: 0 },
  ],
};

export const sampleTeam = {
  id: 10,
  name: "Butlers",
  subtitle: "We fetch",
  description: "",
  contact: "@butlers",
  joinCode: "abc",
  tableNumber: null,
  peerReviewRound: null,
  role: "lead",
};
