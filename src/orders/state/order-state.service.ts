import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { apiError } from '../../common/api-error';
import type { ActorType } from '../entities/order-event.entity';
import type { CancelReason, OrderStatus } from '../entities/order.entity';
import {
  OrderTransition,
  TransitionContext,
  decideTransition,
} from './order-transitions';

export interface TransitionActor {
  type: ActorType;
  userId?: string | null;
}

export interface TransitionOptions {
  /** Facts some transitions need (see TransitionContext). */
  ctx?: TransitionContext;
  note?: string;
  meta?: Record<string, unknown>;
  /** Run inside the caller's transaction so side effects commit or roll back with the status. */
  manager?: EntityManager;
}

export type TransitionResult =
  | {
      applied: true;
      from: OrderStatus;
      to: OrderStatus;
      cancelReason: CancelReason | null;
      outcome?: 'rto_requested';
      lld: string;
    }
  | { applied: false; from: OrderStatus; reason: string };

/** Jobs and webhooks retry; an out-of-date request from them is a no-op, not an error (LLD §3.1). */
const JOB_ACTORS: readonly ActorType[] = ['system', 'webhook'];

/**
 * The only place an order's status changes (LLD v1.4 §3.1).
 *
 * Rules come from `decideTransition`; this service applies them with a guarded
 * `UPDATE … WHERE id = $1 AND status = $from` so two concurrent requests can't
 * both win, and writes the `order_events` row in the same transaction.
 * Side effects (stock, refunds, entitlements, notifications) are added by the
 * callers inside the same transaction via `options.manager`.
 */
@Injectable()
export class OrderStateService {
  constructor(private readonly dataSource: DataSource) {}

  transition(
    orderId: string,
    transition: OrderTransition,
    actor: TransitionActor,
    options: TransitionOptions = {},
  ): Promise<TransitionResult> {
    const run = (m: EntityManager) =>
      this.apply(m, orderId, transition, actor, options);
    return options.manager
      ? run(options.manager)
      : this.dataSource.transaction(run);
  }

  private async apply(
    m: EntityManager,
    orderId: string,
    transition: OrderTransition,
    actor: TransitionActor,
    options: TransitionOptions,
  ): Promise<TransitionResult> {
    const rows: Array<{ status: OrderStatus }> = await m.query(
      'SELECT "status" FROM "orders" WHERE "id" = $1',
      [orderId],
    );
    if (rows.length === 0)
      throw apiError(404, 'NOT_FOUND', `Order ${orderId} not found`);
    const from = rows[0].status;
    const isJob = JOB_ACTORS.includes(actor.type);

    const decision = decideTransition(
      transition,
      from,
      actor.type,
      options.ctx,
    );
    if ('code' in decision) {
      if (decision.code === 'FORBIDDEN')
        throw apiError(403, 'FORBIDDEN', decision.reason);
      if (isJob) return { applied: false, from, reason: decision.reason };
      throw apiError(409, 'INVALID_TRANSITION', decision.reason);
    }

    // Guarded update: succeeds only if the status is still what we decided on.
    // Under concurrency the second writer waits on the row lock, re-checks the
    // WHERE after the first commits, and updates nothing.
    const [{ n }]: Array<{ n: number }> = await m.query(
      `WITH u AS (
         UPDATE "orders" SET "status" = $3, "cancel_reason" = $4, "updated_at" = now()
         WHERE "id" = $1 AND "status" = $2
         RETURNING 1
       ) SELECT count(*)::int AS n FROM u`,
      [
        orderId,
        from,
        decision.to,
        decision.to === 'cancelled' ? decision.cancelReason : null,
      ],
    );
    if (n === 0) {
      const reason = `order ${orderId} changed while this request was being processed`;
      if (isJob) return { applied: false, from, reason };
      throw apiError(409, 'INVALID_TRANSITION', reason);
    }

    const meta = decision.outcome
      ? { ...options.meta, outcome: decision.outcome }
      : (options.meta ?? null);
    await m.query(
      `INSERT INTO "order_events" ("order_id", "actor_type", "actor_user_id", "from_status", "to_status", "event", "note", "meta")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        orderId,
        actor.type,
        actor.userId ?? null,
        from,
        decision.to,
        transition,
        options.note ?? null,
        meta === null ? null : JSON.stringify(meta),
      ],
    );

    return {
      applied: true,
      from,
      to: decision.to,
      cancelReason: decision.cancelReason,
      ...(decision.outcome ? { outcome: decision.outcome } : {}),
      lld: decision.lld,
    };
  }
}
