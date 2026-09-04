/**
 * @layer Data Access Layer —— Port 装配（DI）
 * @file api/infra/index.ts
 *
 * 启动时按 env 装配 Adapter（CACHE_DRIVER=memory|redis …，当前仅 memory/sql 落地）。
 * 业务代码只 import 本文件的 Port 单例，不直接 new 适配器（design/arch-v5.md §3.1 DI）。
 */
import { MemoryCache, type CacheStore } from "./cache";
import { SqlSearchIndex, type SearchIndex } from "./search";
import { OutboxEventQueue, type EventQueue } from "./queue";
import { getDataSource } from "./datasource";

export type { CacheStore } from "./cache";
export type { SearchIndex, SearchQuery, SearchResult } from "./search";
export type { EventQueue, DomainEvent, BatchEventHandler } from "./queue";
export { getDataSource, timedRead, isDupEntry, type RWDataSource, type Db } from "./datasource";
export { getAnalytics, type AnalyticsStore } from "./analytics";
export { log, warnSlowQuery } from "./logger";

let cache: CacheStore | null = null;
let search: SearchIndex | null = null;
let queue: EventQueue | null = null;

export function getCache(): CacheStore {
  if (!cache) {
    // CACHE_DRIVER=redis 时切换 RedisCache（TODO: 阶段二）；当前仅 memory
    cache = new MemoryCache();
  }
  return cache;
}

export function getSearch(): SearchIndex {
  if (!search) {
    // SEARCH_DRIVER=es 时切换 ElasticSearchIndex（TODO: 阶段二）
    search = new SqlSearchIndex(getDataSource().read());
  }
  return search;
}

export function getQueue(): EventQueue {
  if (!queue) {
    // QUEUE_DRIVER=kafka 时切换 KafkaEventQueue（TODO: 阶段二）
    queue = new OutboxEventQueue(getDataSource().write());
  }
  return queue;
}
