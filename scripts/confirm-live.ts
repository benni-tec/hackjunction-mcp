/**
 * Human gate for scripts that talk to the real Junction platform.
 *
 * Refuses to run without an interactive terminal (so agents, CI and piped input can't trigger it), then asks the
 * person to type a confirmation. Bursts of requests got this machine's IP challenged by Vercel on 2026-11-13, and the
 * account is needed for the hackathon.
 */
import { createInterface } from "node:readline/promises";

const PHRASE = "send";

export async function confirmLive(plan: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "Refusing to contact hackjunction.app: this needs a person at an interactive terminal to confirm.\n" +
        "Agents: don't work around this. Ask the user to run it themselves.",
    );
    process.exit(2);
  }

  console.log(`This will contact the REAL Junction platform with your account:\n  ${plan}`);
  console.log("Requests are sent one at a time and stop at the first Security Checkpoint or rate limit.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type "${PHRASE}" to continue: `);
  rl.close();
  if (answer.trim() !== PHRASE) {
    console.error("Cancelled; nothing was sent.");
    process.exit(1);
  }
}
