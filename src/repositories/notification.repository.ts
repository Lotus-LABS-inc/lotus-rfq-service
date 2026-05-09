import type { Pool } from "pg";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface UserNotification {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  targetKind: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface ListNotificationsInput {
  userId: string;
  limit: number;
  cursor?: string | undefined;
}

export interface ListNotificationsResult {
  items: UserNotification[];
  nextCursor: string | null;
}

export interface NotificationRepository {
  listNotifications(input: ListNotificationsInput): Promise<ListNotificationsResult>;
  markRead(input: { userId: string; notificationId: string }): Promise<UserNotification | null>;
  markAllRead(input: { userId: string }): Promise<number>;
  createNotification(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    severity?: NotificationSeverity | undefined;
    targetKind?: string | null | undefined;
    targetId?: string | null | undefined;
    payload?: Record<string, unknown> | undefined;
  }): Promise<UserNotification>;
}

interface NotificationRow {
  notification_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  target_kind: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  read_at: Date | string | null;
  created_at: Date | string;
}

export class PgNotificationRepository implements NotificationRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly onCreate?: ((notification: UserNotification) => Promise<void>) | undefined
  ) {}

  public async listNotifications(input: ListNotificationsInput): Promise<ListNotificationsResult> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const values: unknown[] = [input.userId];
    const clauses = ["user_id = $1"];
    if (input.cursor) {
      values.push(input.cursor);
      clauses.push(`created_at < $${values.length}::timestamptz`);
    }
    values.push(limit + 1);
    const result = await this.pool.query<NotificationRow>(
      `SELECT *
       FROM user_notifications
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(mapNotificationRow),
      nextCursor: result.rows.length > limit ? toIso(rows[rows.length - 1]!.created_at) : null
    };
  }

  public async markRead(input: { userId: string; notificationId: string }): Promise<UserNotification | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, now())
       WHERE user_id = $1 AND notification_id = $2
       RETURNING *`,
      [input.userId, input.notificationId]
    );
    return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
  }

  public async markAllRead(input: { userId: string }): Promise<number> {
    const result = await this.pool.query(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, now())
       WHERE user_id = $1 AND read_at IS NULL`,
      [input.userId]
    );
    return result.rowCount ?? 0;
  }

  public async createNotification(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    severity?: NotificationSeverity | undefined;
    targetKind?: string | null | undefined;
    targetId?: string | null | undefined;
    payload?: Record<string, unknown> | undefined;
  }): Promise<UserNotification> {
    const result = await this.pool.query<NotificationRow>(
      `INSERT INTO user_notifications (
        user_id,
        type,
        title,
        body,
        severity,
        target_kind,
        target_id,
        payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *`,
      [
        input.userId,
        input.type,
        input.title,
        input.body,
        input.severity ?? "info",
        input.targetKind ?? null,
        input.targetId ?? null,
        JSON.stringify(input.payload ?? {})
      ]
    );
    const notification = mapNotificationRow(result.rows[0]!);
    await this.onCreate?.(notification);
    return notification;
  }
}

const mapNotificationRow = (row: NotificationRow): UserNotification => ({
  notificationId: row.notification_id,
  userId: row.user_id,
  type: row.type,
  title: row.title,
  body: row.body,
  severity: row.severity,
  targetKind: row.target_kind,
  targetId: row.target_id,
  payload: row.payload ?? {},
  readAt: row.read_at ? toIso(row.read_at) : null,
  createdAt: toIso(row.created_at)
});

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
