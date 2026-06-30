import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate } from '@/lib/format';
import { listOpenTasks } from '@/modules/freight/queries';
import { setTaskStatus } from '@/modules/freight/actions';

export const metadata = { title: 'Tasks — Jupiter Logistics' };

const PRIORITY_BADGE: Record<string, string> = { urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-neutral', low: 'badge-neutral' };

export default async function TasksPage() {
  await requireModule('freight', 'freight.shipments.manage');
  const tasks = await listOpenTasks();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Tasks</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>Every open task across all shipments. Many are raised automatically as shipments advance.</p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Nothing outstanding</h2>
          <p className="muted" style={{ marginTop: 0 }}>Tasks will appear here as shipments move through their lifecycle.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th style={{ width: 130 }}>Shipment</th>
                <th style={{ width: 90 }}>Priority</th>
                <th className="date" style={{ width: 120 }}>Due</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}{t.auto_generated ? <span className="badge badge-neutral" style={{ marginLeft: 8 }}>auto</span> : null}</td>
                  <td>{t.shipment_id ? <Link href={`/freight/shipments/${t.shipment_id}`}>{t.shipmentRef ?? 'open'}</Link> : <span className="muted">—</span>}</td>
                  <td><span className={`badge ${PRIORITY_BADGE[t.priority] ?? 'badge-neutral'}`}>{t.priority}</span></td>
                  <td className="muted date">{formatDate(t.due_at)}</td>
                  <td>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <input type="hidden" name="return_to" value="/freight/tasks" />
                      <button className="btn btn-ghost btn-sm" type="submit">Mark done</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
