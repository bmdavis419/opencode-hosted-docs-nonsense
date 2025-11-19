import { Effect } from "effect";
import { contextRepos } from "../../config";
import { createSnapshot } from "../../services/snapshot";

const config = contextRepos.daytona;

export const createDaytonaSnapshot = createSnapshot(config).pipe(
  Effect.matchCause({
    onSuccess: () => {
      console.log("Snapshot created successfully");
      process.exit(0);
    },
    onFailure: (err) => {
      console.error("it died", err);
      process.exit(1);
    },
  })
);

await createDaytonaSnapshot.pipe(Effect.runPromise);
