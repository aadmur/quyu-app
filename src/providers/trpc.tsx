import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

/**
 * QueryClient 默认值（QY-PERF-006）
 *
 * 改造前 `new QueryClient()` 全用库默认值，问题有三：
 *
 * 1. `staleTime` 默认 0 → 同一份数据在页面间来回走一次就重新请求一次。
 *    全项目 53 处 useQuery 里只有 15 处显式设了 staleTime，其余 38 处
 *    每次挂载都打一次网络。钓场列表、公告、票种这类秒级不变的数据
 *    被反复拉取，在 2C2G 的服务端是实打实的浪费。
 * 2. `refetchOnWindowFocus` 默认 true → App 从后台切回前台（移动端高频）
 *    会把当前页所有 query 全部重取。全项目只有 ShareCardSheet 一处
 *    显式关掉了它，说明这是普遍存在的、未被处理的默认行为。
 * 3. `retry` 默认 3 次指数退避 → 后端 5xx 时移动端会静默重试约 7 秒，
 *    用户看到的是长时间骨架屏而非错误提示。
 *
 * 取值依据（均为保守值，不影响数据时效性要求高的场景）：
 * - staleTime 30s：覆盖「列表 → 详情 → 返回列表」的典型往返，30 秒内
 *   不重复请求；对时效敏感的调用点（权限、未读数）已有更短或轮询配置。
 * - gcTime 5min：离开页面后缓存保留 5 分钟，返回时秒开且不请求。
 * - refetchOnWindowFocus false：改为挂载时判定 stale 来决定是否请求，
 *   避免移动端切前台引发的批量重取风暴。
 * - refetchOnReconnect true：断网恢复必须重取，这是真正的数据一致性问题。
 * - retry 1：失败重试 1 次（而非 3 次），让错误更快暴露给用户。
 *
 * 显式传入的配置仍然优先，因此上述 15 处已调优的调用点不受影响。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 3000),
    },
    mutations: {
      // 写操作不重试：评论/下单/核销这类接口重试可能造成重复提交
      retry: 0,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
