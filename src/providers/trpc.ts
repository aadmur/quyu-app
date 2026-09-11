import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../api/router";

/**
 * tRPC React 客户端实例（全局单例）。
 *
 * 本文件刻意不含任何 React 组件：react-refresh 要求「一个模块要么只导出组件，
 * 要么只导出非组件」，实例与 Provider 混在一个文件里会让 Fast Refresh 退化为
 * 整页刷新。Provider 见 @/providers/TRPCProvider。
 *
 * 对外导入路径保持 @/providers/trpc 不变，业务侧无需改动。
 */
export const trpc = createTRPCReact<AppRouter>();
