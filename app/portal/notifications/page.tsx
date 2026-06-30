import Link from 'next/link';
import type { Route } from 'next';
import { requirePortal } from '@/core/session/portal-guard';
import { getPortalNotifications, markAllNotificationsRead } from '@/modules/freight/portal/notifications';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Notifications — Jupiter Logistics' };

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export default async function PortalNotifications() {
  await requirePortal();
  const items = await getPortalNotifications();
  const hasUnread = items.some((n) => !n.read_at);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>Notifications</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Updates about your shipments.</p>
        </div>
        {hasUnread ? (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="btn btn-ghost btn-sm">Mark all read</button>
          </form>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>No notifications yet. We&apos;ll let you know when something happens with your shipments.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((n) => {
            const inner = (
              <div className="card" style={{ padding: 14, borderLeft: n.read_at ? '3px solid transparent' : '3px solid var(--primary)' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <strong style={{ color: 'var(--ink)' }}>{n.subject ?? pretty(n.kind)}</strong>
                  <span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>{formatDate(n.created_at)}</span>
                </div>
                {n.body ? <p className="muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>{n.body}</p> : null}
              </div>
            );
            return n.shipment_id ? (
              <Link key={n.id} href={`/portal/shipments/${n.shipment_id}` as Route} style={{ display: 'block' }}>{inner}</Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
