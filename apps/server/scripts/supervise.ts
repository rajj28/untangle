import { spawn } from "node:child_process";

// Keeps the server running the way a host like Render does: whenever it exits (the "pull the plug" demo
// exits with 75), start it again. Gives up if it keeps dying right after starting.
const QUICK_EXIT_MS = 5_000;
const MAX_QUICK_EXITS = 3;
let quickExits = 0;
let stopping = false;

function start(): void {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { stdio: "inherit", env: process.env });
  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    child.kill(signal);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.on("exit", (code, signal) => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (stopping) process.exit(0);
    quickExits = Date.now() - startedAt < QUICK_EXIT_MS ? quickExits + 1 : 0;
    if (quickExits >= MAX_QUICK_EXITS) {
      console.error(`supervisor: the server exited ${MAX_QUICK_EXITS} times right after starting; giving up`);
      process.exit(1);
    }
    console.log(`supervisor: server exited (${signal ?? code}); restarting in 1s`);
    setTimeout(start, 1_000);
  });
}

start();
