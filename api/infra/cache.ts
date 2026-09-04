/**
 * @layer Data Access Layer —— CacheStore Port（缓存抽象）
 * @file api/infra/cache.ts
 *
 * Port 语义严格对齐 Redis（get/set/del/incr/expire/SET NX 锁），
 * 业务代码只依赖 CacheStore 接口；当前注入进程内 MemoryCache 适配器，
 * 未来切换 RedisCache 时业务零改动（见 design/arch-v5.md §3.3）。
 *
 * 注意：进程易失 → MemoryCache 允许丢失，绝不作为唯一数据源（SSOT 永远是 TiDB）。
 */

export type ReleaseFn = () => Promise<void>;

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** 原子自增，返回新值（对应 Redis INCRBY）。多实例部署时必须切 Redis。 */
  incr(key: string, by?: number): Promise<number>;
  /** 设置过期时间（对应 Redis EXPIRE），key 不存在返回 false。 */
  expire(key: string, ttlSec: number): Promise<boolean>;
  /** 带 TTL 的锁（对应 SET NX EX），抢占失败返回 null。 */
  lock(key: string, ttlSec: number): Promise<ReleaseFn | null>;
  /** 防缓存击穿：single-flight 回源，同 key 并发只放行一个 loader。 */
  getOrSet<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T>;
  /** 按 tag 批量失效（命名空间版本号实现，对应 Redis 无原生 tag）。 */
  invalidateTag(tag: string): Promise<void>;
  /** 生成带 tag 命名空间版本号的业务 key。 */
  taggedKey(tag: string, key: string): Promise<string>;
}

interface Entry {
  value: unknown;
  expiresAt: number; // 0 = 永不过期
  lastAccess: number;
}

const MAX_KEYS = 10_000;
/** TTL 抖动 ±20%，防雪崩（arch-v5 §5.3） */
function jitter(ttlSec: number): number {
  return ttlSec * (0.8 + Math.random() * 0.4);
}

export class MemoryCache implements CacheStore {
  private store = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  private tagVersion = new Map<string, number>();
  private locks = new Map<string, number>(); // key -> 过期时间戳

  private now() {
    return Date.now();
  }

  private live(key: string): Entry | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt > 0 && e.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  private evictIfFull() {
    if (this.store.size <= MAX_KEYS) return;
    // LRU：淘汰最久未访问的 10%
    const sorted = [...this.store.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (const [k] of sorted.slice(0, Math.ceil(MAX_KEYS * 0.1))) this.store.delete(k);
  }

  async get<T>(key: string): Promise<T | null> {
    const e = this.live(key);
    if (!e) return null;
    e.lastAccess = this.now();
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    this.evictIfFull();
    const expiresAt = ttlSec && ttlSec > 0 ? this.now() + jitter(ttlSec) * 1000 : 0;
    this.store.set(key, { value, expiresAt, lastAccess: this.now() });
  }

  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.store.delete(k);
  }

  async incr(key: string, by = 1): Promise<number> {
    const e = this.live(key);
    const next = (e ? Number(e.value) || 0 : 0) + by;
    // JS 单线程：读-改-写在同 tick 内天然原子；接口语义对齐 Redis INCR，多实例须切 RedisCache
    this.store.set(key, {
      value: next,
      expiresAt: e?.expiresAt ?? 0,
      lastAccess: this.now(),
    });
    return next;
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    const e = this.live(key);
    if (!e) return false;
    e.expiresAt = this.now() + ttlSec * 1000;
    return true;
  }

  async lock(key: string, ttlSec: number): Promise<ReleaseFn | null> {
    const until = this.locks.get(key);
    if (until && until > this.now()) return null;
    this.locks.set(key, this.now() + ttlSec * 1000);
    return async () => {
      this.locks.delete(key);
    };
  }

  async getOrSet<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    // single-flight：同 key 并发回源只放一个请求，其余等待同一 Promise
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = loader()
      .then(async (v) => {
        await this.set(key, v, ttlSec);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async invalidateTag(tag: string): Promise<void> {
    this.tagVersion.set(tag, (this.tagVersion.get(tag) ?? 0) + 1);
  }

  async taggedKey(tag: string, key: string): Promise<string> {
    return `${tag}:v${this.tagVersion.get(tag) ?? 0}:${key}`;
  }
}
