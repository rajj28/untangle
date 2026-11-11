import { runVerification } from "./verify.ts";

// Runs the 10,000-network net-position proof off the main thread.
self.addEventListener("message", (event: MessageEvent<{ count: number }>) => {
  const count = event.data.count ?? 10_000;
  const result = runVerification(count);
  self.postMessage(result);
});
