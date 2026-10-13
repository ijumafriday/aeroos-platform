import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NotificationDto, Severity } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { notifications } from '../database/platform.tables';
import { OutboxService } from '../events/outbox';

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb, private readonly outbox: OutboxService) {}

  /** Raise a notification inside the calling module's transaction (and announce it live). */
  async raise(mdb: ModuleDb, n: { operatorId: string; severity: Severity; title: string; body: string; link?: string | null; actor: string }) {
    mdb.requireTransaction('Raising a notification');
    const id = newId();
    await mdb.db.insert(notifications).values({ id, operatorId: n.operatorId, severity: n.severity, title: n.title, body: n.body, link: n.link ?? null });
    await this.outbox.add(mdb, {
      type: 'platform.notification.raised',
      data: { notificationId: id, severity: n.severity, title: n.title, body: n.body, link: n.link ?? null }
    }, { operatorId: n.operatorId, actor: n.actor });
    return id;
  }

  async list(operatorId: string, subject: string, limit = 50): Promise<NotificationDto[]> {
    const rows = await this.db.db.select().from(notifications).where(eq(notifications.operatorId, operatorId)).orderBy(desc(notifications.createdAt)).limit(limit);
    return rows.map(r => ({ id: r.id, severity: r.severity as Severity, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt.toISOString(), read: r.readBy.includes(subject) }));
  }

  async markRead(operatorId: string, id: string, subject: string) {
    await this.db.db.update(notifications)
      .set({ readBy: sql`array_append(${notifications.readBy}, ${subject})` })
      .where(and(eq(notifications.id, id), eq(notifications.operatorId, operatorId), sql`not (${subject} = any(${notifications.readBy}))`));
  }

  async markAllRead(operatorId: string, subject: string) {
    await this.db.db.update(notifications)
      .set({ readBy: sql`array_append(${notifications.readBy}, ${subject})` })
      .where(and(eq(notifications.operatorId, operatorId), sql`not (${subject} = any(${notifications.readBy}))`));
  }
}
