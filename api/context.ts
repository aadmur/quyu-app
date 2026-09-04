import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  /** 真实连接 IP（socket remoteAddress，由 boot.ts 注入）；不信任客户端可伪造的 XFF */
  ip?: string;
};

export async function createContext(
  opts: FetchCreateContextFnOptions & { ip?: string },
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders, ip: opts.ip };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
