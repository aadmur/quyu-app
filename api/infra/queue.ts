/**
 * @layer Data Access Layer —— EventQueue Port（队列抽象）
 * @file api/infra/queue.ts
 *
 * 语义：at-least-once 投递 + 消费端幂等（processed_events 去重）。
 * 当前适配器 OutboxEventQueue：
 * - publish/publishBatch 为**真异步**：事件先进内存 ring buffer 立即返回（无任何 DB RT），
 *   后台 tick 批量持久化到 outbox_events（多值 INSERT，≤500 条/批），再批量派发。
 *   崩溃丢失窗口 < 1 个 tick（200ms），埋点/画像类事件业务允许（design/arch-v5.md §5.7 track
 *   "不同步落库"）；订单关键事件（order.created）由业务方在事务内直写 outbox，不经此路径。
 * - 消费端批处理：subscribeBatch 按 topic 整批回调（user_events 批量 INSERT、计数按 postId
 *   聚合）；processed_events / outbox done 标记均按批合并为单条 SQL；handler 任务按
 *   DISPATCH_WORKERS 并行执行（多 worker 分片消费）。
 * - 崩溃恢复：tick 在内存缓冲为空时轮询 outbox pending 行重放（processed_events 幂等去重）。
 * 未来切换 KafkaEventQueue 时事件 schema 不变、业务零改动（design/arch-v5.md §3.3）。
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { outboxEvents } from "@db/schema";
import { log } from "./logger";

export interface DomainEvent<T = unknown> {
  eventId: string; // ULID/UUID，幂等键
  topic: string; // 命名规范 <domain>.<entity>.<verb>
  aggregateId: string;
  payload: T;
  occurredAt: number;
  traceId: string;
}

export type EventHandler = (e: DomainEvent) => Promise<void>;
/** 批量 handler：同 topic 的一批事件一次回调（消费者内部聚合为少量 SQL） */
export type BatchEventHandler = (events: DomainEvent[]) => Promise<void>;

export interface BatchSubscribeOptions {
  /**
   * 批量分片粒度（默认 BATCH_HANDLER_CHUNK=100）。热点计数聚合类消费者宜调大：
   * 分片越小，对同一批热点行的并发 UPDATE 越多，TiDB 乐观锁冲突越严重。
   */
  chunkSize?: number;
}

export interface EventQueue {
  /** 真异步：入内存缓冲即返回，不等待任何 DB 往返 */
  publish<T>(topic: string, payload: T, opts?: { aggregateId?: string; traceId?: string }): Promise<void>;
  publishBatch<T>(topic: string, payloads: T[], opts?: { traceId?: string }): Promise<void>;
  subscribe(topic: string, handler: EventHandler): void;
  /** 批量订阅：同 topic 事件聚合后一次回调（与 subscribe 并存，二者都会收到） */
  subscribeBatch(topic: string, handler: BatchEventHandler, opts?: BatchSubscribeOptions): void;
  /** 等待内存缓冲中的事件全部派发完（测试/关停用）。 */
  flush(): Promise<void>;
  stop(): void;
}

const DISPATCH_BATCH = 1000; // 单 tick 派发上限（摊薄每 tick 固定的 去重/标记 RT 开销）
const POLL_MS = 200; // 派发节拍（= 崩溃丢失窗口上限）
const PERSIST_CHUNK = 500; // outbox 批量持久化分片
const BATCH_HANDLER_CHUNK = 100; // 批量 handler 的分片粒度（并行 worker 单元）
const DISPATCH_WORKERS = 8; // 并行消费的 worker 数（handler 任务分片并行，连接池 50 下有富余）
const MAX_BUFFER = 20_000; // ring buffer 上限：溢出时丢弃最旧事件（埋点允许丢）

interface Buffered {
  event: DomainEvent;
  persisted: boolean; // 是否已落 outbox（崩溃可恢复）
  recovered: boolean; // 是否来自 outbox 恢复轮询（flush 不等待此类事件，避免积压重放阻塞 flush）
}

export class OutboxEventQueue implements EventQueue {
  private handlers = new Map<string, EventHandler[]>();
  private batchHandlers = new Map<string, Array<{ handler: BatchEventHandler; chunkSize: number }>>();
  private buffer = new Map<string, Buffered>(); // 待派发（内存快路径，插入序即 ring 顺序）
  private deferred = new Map<string, DomainEvent>(); // 暂无订阅者的事件（仅内存，等 subscribe 后激活）
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private drainWaiters: Array<() => void> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any) {
    this.db = db;
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.dispatchTick(), POLL_MS);
    this.timer.unref?.(); // 不阻止进程退出
  }

  private hasSubscriber(topic: string): boolean {
    return (this.handlers.get(topic)?.length ?? 0) > 0 || (this.batchHandlers.get(topic)?.length ?? 0) > 0;
  }

  /** 入 ring buffer（溢出时从头部丢最旧事件，保证内存有界） */
  private enqueue(event: DomainEvent): void {
    if (this.buffer.size >= MAX_BUFFER) {
      const oldest = this.buffer.keys().next().value;
      if (oldest !== undefined) {
        this.buffer.delete(oldest);
        log("warn", "queue ring buffer full, dropped oldest event", { topic: event.topic, maxBuffer: MAX_BUFFER });
      }
    }
    this.buffer.set(event.eventId, { event, persisted: false, recovered: false });
  }

  async publish<T>(topic: string, payload: T, opts?: { aggregateId?: string; traceId?: string }): Promise<void> {
    const event: DomainEvent<T> = {
      eventId: randomUUID(),
      topic,
      aggregateId: opts?.aggregateId ?? "",
      payload,
      occurredAt: Date.now(),
      traceId: opts?.traceId ?? randomUUID(),
    };
    // 真异步：只进内存缓冲立即返回；outbox 落库由后台 tick 批量完成（≤200ms 窗口）
    this.enqueue(event as DomainEvent);
    this.ensureTimer();
    void this.dispatchTick();
  }

  async publishBatch<T>(topic: string, payloads: T[], opts?: { traceId?: string }): Promise<void> {
    if (payloads.length === 0) return;
    const traceId = opts?.traceId ?? randomUUID();
    for (const p of payloads) {
      this.enqueue({
        eventId: randomUUID(),
        topic,
        aggregateId: "",
        payload: p,
        occurredAt: Date.now(),
        traceId,
      } as DomainEvent);
    }
    this.ensureTimer();
    void this.dispatchTick();
  }

  subscribe(topic: string, handler: EventHandler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
    this.activateDeferred(topic);
  }

  subscribeBatch(topic: string, handler: BatchEventHandler, opts?: BatchSubscribeOptions): void {
    const list = this.batchHandlers.get(topic) ?? [];
    list.push({ handler, chunkSize: Math.max(1, opts?.chunkSize ?? BATCH_HANDLER_CHUNK) });
    this.batchHandlers.set(topic, list);
    this.activateDeferred(topic);
  }

  /** 激活该 topic 的滞留事件（从 deferred 移回 buffer） */
  private activateDeferred(topic: string) {
    for (const [id, e] of this.deferred) {
      if (e.topic === topic) {
        this.deferred.delete(id);
        this.buffer.set(id, { event: e, persisted: false, recovered: false });
      }
    }
    this.ensureTimer();
  }

  private hasLiveEvents(): boolean {
    for (const b of this.buffer.values()) if (!b.recovered) return true;
    return false;
  }

  /** 单 tick：内存缓冲优先；缓冲空时轮询 outbox 恢复遗留事件（崩溃恢复路径） */
  private async dispatchTick(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.doDispatch().finally(() => {
      this.draining = null;
      if (!this.hasLiveEvents()) {
        const waiters = this.drainWaiters.splice(0);
        for (const w of waiters) w();
      }
    });
    return this.draining;
  }

  /** 批量持久化：未落库事件合并为一条多值 INSERT（每片 ≤PERSIST_CHUNK，分片并行） */
  private async persistBatch(items: Buffered[]): Promise<void> {
    const fresh = items.filter((b) => !b.persisted);
    if (fresh.length === 0) return;
    const chunks: Buffered[][] = [];
    for (let i = 0; i < fresh.length; i += PERSIST_CHUNK) chunks.push(fresh.slice(i, i + PERSIST_CHUNK));
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          await this.db.insert(outboxEvents).values(
            chunk.map((b) => ({
              eventId: b.event.eventId,
              topic: b.event.topic,
              payload: b.event.payload as Record<string, unknown>,
              status: "pending" as const,
            })),
          );
          for (const b of chunk) b.persisted = true;
        } catch (err) {
          // outbox 不可用时仍走内存派发，保证埋点不拖垮业务（丢失窗口内事件，已记录）
          log("warn", "outbox batch insert failed, events kept in memory only", {
            count: chunk.length,
            err: String(err),
          });
        }
      }),
    );
  }

  /**
   * 批量幂等去重（只读）：1 次 SELECT 查出已消费 eventId，返回本次需要真正执行 handler 的事件。
   * 注意：不在此处登记 processed_events——登记必须发生在 handler 成功之后（见 registerProcessed），
   * 否则 handler 失败的事件会被误判已消费而丢弃（at-least-once 名不副实）。
   */
  private async filterProcessed(batch: DomainEvent[]): Promise<DomainEvent[]> {
    if (batch.length === 0) return batch;
    const ids = batch.map((e) => e.eventId);
    try {
      const rows = (await this.db.execute(
        sql`SELECT event_id FROM processed_events WHERE event_id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql.raw(","),
        )})`,
      )) as unknown as [[{ event_id: string }]];
      const done = new Set((rows[0] ?? []).map((r) => String(r.event_id)));
      return batch.filter((e) => !done.has(e.eventId));
    } catch (err) {
      // 去重表不可用时整批跳过本轮（下 tick 重试），宁可晚消费不可丢 at-least-once 语义
      log("warn", "processed_events dedup failed, batch postponed", { count: batch.length, err: String(err) });
      throw err;
    }
  }

  /**
   * handler 执行成功后登记消费记录（1 条 INSERT IGNORE 批量写入）。
   * 放在成功之后：失败事件不登记、留 buffer 下轮重试（at-least-once + 消费端幂等）。
   * 崩溃窗口：handler 成功但登记前崩溃 → 重放时重复执行 handler（由 handler 幂等性兜底）；
   * 并发/重复登记由 event_id 唯一索引 + INSERT IGNORE 兜底。
   */
  private async registerProcessed(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.db.execute(
        sql`INSERT IGNORE INTO processed_events (event_id, topic) VALUES ${sql.join(
          events.map((e) => sql`(${e.eventId}, ${e.topic})`),
          sql.raw(","),
        )}`,
      );
    } catch (err) {
      // 登记失败不丢事件：下轮重放 filterProcessed 查不到记录会重投，handler 幂等兜底
      log("warn", "processed_events register failed, events may be redelivered", {
        count: events.length,
        err: String(err),
      });
    }
  }

  /** 批量标记 done（单条 UPDATE ... WHERE event_id IN (...)） */
  private async markDone(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.db.execute(
        sql`UPDATE outbox_events SET status = 'done', processed_at = NOW() WHERE event_id IN (${sql.join(
          events.map((e) => sql`${e.eventId}`),
          sql.raw(","),
        )})`,
      );
    } catch (err) {
      // 标记失败不阻塞：事件仍在 processed_events 中，重放时会被去重跳过
      log("warn", "outbox mark-done failed (rows stay pending, replay will dedup)", {
        count: events.length,
        err: String(err),
      });
    }
  }

  private async doDispatch(): Promise<void> {
    // 1. 恢复路径：内存缓冲为空时捞 outbox 中 pending 的遗留事件（崩溃重启后重放）
    if (this.buffer.size === 0) {
      // 只捞当前有订阅者的 topic：无订阅者的行若混在最旧的一批里会反复占据 LIMIT 窗口，
      // 导致恢复轮询永久卡死（deferred 堆积在内存、DB 行永远 pending）
      const topics = [...new Set([...this.handlers.keys(), ...this.batchHandlers.keys()])];
      if (topics.length === 0) return;
      let pending: Array<{ eventId: string; topic: string; payload: unknown; createdAt: Date }>;
      try {
        pending = await this.db
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.status, "pending"), inArray(outboxEvents.topic, topics)))
          .orderBy(asc(outboxEvents.id))
          .limit(DISPATCH_BATCH);
      } catch (err) {
        log("warn", "outbox recovery poll failed", { err: String(err) });
        return;
      }
      for (const row of pending) {
        if (this.deferred.has(row.eventId)) continue; // 已知无订阅者，跳过
        this.buffer.set(row.eventId, {
          event: {
            eventId: row.eventId,
            topic: row.topic,
            aggregateId: "",
            payload: row.payload,
            occurredAt: row.createdAt.getTime(),
            traceId: row.eventId,
          },
          persisted: true,
          recovered: true,
        });
      }
      if (this.buffer.size === 0) return;
    }

    // 2. 取一批：无订阅者的转入 deferred（仅内存，不落 outbox，避免无消费者 topic 无限积压）
    const batch = [...this.buffer.values()].slice(0, DISPATCH_BATCH);
    const dispatchable: Buffered[] = [];
    for (const b of batch) {
      if (!this.hasSubscriber(b.event.topic)) {
        this.buffer.delete(b.event.eventId);
        this.deferred.set(b.event.eventId, b.event);
        continue;
      }
      dispatchable.push(b);
    }
    if (dispatchable.length === 0) return;

    // 3. 批量持久化到 outbox（先落库后消费，保证崩溃可恢复 = at-least-once）
    await this.persistBatch(dispatchable);

    // 4. 批量幂等去重（只读 SELECT IN，1 次 RT；登记在 handler 成功后进行）
    let fresh: DomainEvent[];
    try {
      fresh = await this.filterProcessed(dispatchable.map((b) => b.event));
    } catch {
      return; // 去重表故障：整批留在 buffer，下 tick 重试
    }
    // 去重命中的事件 = 此前已消费但 done 标记失败/崩溃残留：直接从缓冲移除并补标 done，
    // 否则会永久占据 buffer（恢复轮询只在 buffer 为空时触发，会被这种僵尸事件卡死）
    const freshIds = new Set(fresh.map((e) => e.eventId));
    const dupes = dispatchable.filter((b) => !freshIds.has(b.event.eventId)).map((b) => b.event);
    for (const e of dupes) this.buffer.delete(e.eventId);
    await this.markDone(dupes);

    // 5. 派发：按 topic 分组，批量 handler 切 100 条/片，逐条 handler 并入一片；
    //    所有任务分片由 DISPATCH_WORKERS 个 worker 并行消费（连接池上并行，非串行逐条）
    type Task = { events: DomainEvent[]; run: () => Promise<void> };
    const tasks: Task[] = [];
    const byTopic = new Map<string, DomainEvent[]>();
    for (const e of fresh) {
      const list = byTopic.get(e.topic) ?? [];
      list.push(e);
      byTopic.set(e.topic, list);
    }
    for (const [topic, events] of byTopic) {
      const batchHs = this.batchHandlers.get(topic) ?? [];
      const singleHs = this.handlers.get(topic) ?? [];
      if (batchHs.length > 0) {
        // 按订阅方声明的 chunkSize 分片（取各订阅者的最小粒度）
        const chunkSize = Math.min(...batchHs.map((b) => b.chunkSize));
        for (let i = 0; i < events.length; i += chunkSize) {
          const chunk = events.slice(i, i + chunkSize);
          tasks.push({
            events: chunk,
            run: async () => {
              for (const b of batchHs) await b.handler(chunk);
              if (singleHs.length > 0) await Promise.all(chunk.map((e) => singleHs.map((h) => h(e))).flat());
            },
          });
        }
      } else {
        // 无批量 handler 的 topic：逐条 handler 并行执行，但小分片（16）避免瞬间打满连接池
        for (let i = 0; i < events.length; i += 16) {
          const chunk = events.slice(i, i + 16);
          tasks.push({
            events: chunk,
            run: () => Promise.all(chunk.map(async (e) => { for (const h of singleHs) await h(e); })).then(() => {}),
          });
        }
      }
    }

    const succeeded: DomainEvent[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        try {
          await task.run();
          succeeded.push(...task.events);
          for (const e of task.events) this.buffer.delete(e.eventId);
        } catch (err) {
          // handler 失败：保持 pending + 留在缓冲，下一轮重试（at-least-once）
          log("error", "event handler failed, will retry", {
            topic: task.events[0]?.topic,
            count: task.events.length,
            err: String(err),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(DISPATCH_WORKERS, tasks.length) }, () => worker()));

    // 6. 成功事件：先登记 processed_events（消费完成的判定依据），再批量标记 outbox done（1 次 RT）；
    //    失败的分片不登记、留在 buffer 下 tick 重试（at-least-once）
    await this.registerProcessed(succeeded);
    await this.markDone(succeeded);
  }

  /** 等待内存中新发布的事件派发完（测试/关停用）；不等待 outbox 积压的恢复重放 */
  async flush(): Promise<void> {
    while (this.hasLiveEvents()) {
      await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
    }
    // 再补一枪，确保最后一个 tick 落库标记完成
    await this.dispatchTick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
