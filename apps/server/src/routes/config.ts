import type { FastifyPluginAsync } from "fastify";
import { asc } from "drizzle-orm";
import { networks } from "@untangle/db";
import type { AppContext } from "../context.ts";

export const configRoutes: FastifyPluginAsync<{ ctx: AppContext; mode: "sandbox" | "sim" }> = async (app, options) => {
  app.get("/api/config", async () => {
    const [network] = await options.ctx.db.select({ id: networks.id, currency: networks.currency }).from(networks)
      .orderBy(asc(networks.createdAt)).limit(1);
    return {
      mode: options.mode,
      demo: options.ctx.config.demoMode,
      networkId: network?.id ?? null,
      currency: network?.currency ?? options.ctx.config.currency,
      paypalSdkUrl: options.mode === "sandbox" ? "https://www.sandbox.paypal.com/web-sdk/v6/core" : null,
      agGridLicenseKey: options.ctx.config.agGridLicenseKey ?? null,
      writeProtected: options.ctx.config.demoWriteToken !== undefined,
    };
  });
};
