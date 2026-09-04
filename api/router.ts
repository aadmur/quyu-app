import { authRouter } from "./auth-router";
import { featureRouter } from "./feature-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  app: featureRouter,
});

export type AppRouter = typeof appRouter;
