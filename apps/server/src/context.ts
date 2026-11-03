import type { Db } from "@untangle/db";
import type { Config } from "./config.ts";
import { Bus } from "./bus.ts";
import { JobRunner } from "./jobs.ts";
import { KeyedLock } from "./locks.ts";
import { PayPalRegistry } from "./paypal-registry.ts";
import type { Gemini } from "./ai/gemini.ts";
import type { PaypalToolFactory } from "./ai/paypal-tools.ts";
import { simulatedFactory, toolkitFactory } from "./ai/paypal-tools.ts";

export interface AppContext {
  db: Db;
  config: Config;
  paypal: PayPalRegistry;
  bus: Bus;
  jobs: JobRunner;
  locks: KeyedLock;
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** Gemini is null when no key is configured; PayPal tools come from the Agent Toolkit (or the simulator). */
  ai: { gemini: Gemini | null; paypalTools: PaypalToolFactory };
}

export function createContext(input: {
  db: Db;
  config: Config;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  gemini?: Gemini | null;
  /** "toolkit" (default) uses the real PayPal Agent Toolkit; "simulated" drives the simulator instead. */
  paypalTools?: "toolkit" | "simulated" | PaypalToolFactory;
}): AppContext {
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const registryOptions = {
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
  };
  const paypal = new PayPalRegistry(input.db, input.config.masterKey, registryOptions);
  const paypalTools = typeof input.paypalTools === "function" ? input.paypalTools
    : input.paypalTools === "simulated" ? simulatedFactory((businessId) => paypal.forBusiness(businessId))
      : toolkitFactory((businessId) => paypal.credentialsFor(businessId));
  return {
    db: input.db,
    config: input.config,
    paypal,
    bus: new Bus(input.db),
    jobs: new JobRunner(input.db, now),
    locks: new KeyedLock(),
    now,
    sleep,
    ai: { gemini: input.gemini ?? null, paypalTools },
  };
}
