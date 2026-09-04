import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler, createOAuthNonceHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthNonce, createOAuthNonceHandler());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
// 用户上传目录（头像等）：独立于 dist/public（vite build 的 emptyOutDir 会清空 dist），
// root "./" 相对 process.cwd()，由 profileService 写入 <cwd>/uploads/avatars。
app.use("/uploads/*", serveStatic({ root: "./" }));
app.use("/api/trpc/*", async (c) => {
  // 真实连接 IP（node-server 绑定；dev-server 下无 bindings 则为 undefined）。
  // 用于限流维度，刻意不读 x-forwarded-for（客户端可伪造换桶绕过限流）。
  const bindings = c.env as HttpBindings | undefined;
  const ip = bindings?.incoming?.socket?.remoteAddress ?? undefined;
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (opts) => createContext({ ...opts, ip }),
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
