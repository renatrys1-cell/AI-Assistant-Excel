import { useApp } from '../ctx';
import { Badge, Bar, Card, Empty, TaskStatusBadge } from '../components/ui';
import { addDays, fmtDate, monthLabel } from '../../domain/periods';
import { OPEN_FINDING_STATUSES } from '../../domain/checks';
import type { Task } from '../../domain/types';

export function WorkPage() {
  const { api, openTask, openFinding, setSession, go } = useApp();
  const today = api.today();
  const mine = api.tasks().filter((t) => t.assigneeId === api.userId && !['done', 'cancelled'].includes(t.status));
  const todayList = mine.filter((t) => t.plannedDue === today || (t.status === 'in_progress' && t.plannedDue >= today && t.plannedDue <= addDays(today, 1)));
  const overdue = mine.filter((t) => t.plannedDue < today);
  const returned = mine.filter((t) => t.status === 'returned');
  const waiting = mine.filter((t) => t.status === 'waiting_client');
  const myFindings = api.findings(null).filter((f) => f.assigneeId === api.userId && (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status) && !f.taskId);
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const closing = api.tenants().map((t) => ({ t, c: api.periodClose(t.id, prevMonth) })).filter((x) => x.c.pc.status !== 'closed');
  let me: ReturnType<typeof api.team>[number] | undefined;
  try {
    me = api.team(`month:${today.slice(0, 7)}`).find((x) => x.user.id === api.userId);
  } catch {
    me = undefined;
  }
  const List = ({ items, empty }: { items: Task[]; empty: string }) =>
    items.length ? (
      <table className="tbl small">
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
              <td><b>{t.title}</b><div className="muted">{api.db.tenants.find((x) => x.id === t.tenantId)?.name.replace(' (demo)', '')}{t.waitReason ? ` · ${t.waitReason}` : ''}{t.reviewResult?.decision === 'returned' ? ` · ${t.reviewResult.note}` : ''}</div></td>
              <td className="num">{fmtDate(t.plannedDue)} {t.plannedDue < today && <Badge tone="danger">кешікті</Badge>}</td>
              <td><TaskStatusBadge s={t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : <Empty>{empty}</Empty>;
  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>Менің жұмысым</h1>
          <div className="muted small">{api.me().name} · {fmtDate(today)}</div>
        </div>
        <button className="btn" onClick={() => go('/tasks')}>Барлық тапсырма (кесте / Kanban) →</button>
      </div>
      {me && (
        <Card>
          <div className="row between small"><span>Менің жүктемем: <b>{me.kpi.openUnits}</b> / {me.kpi.capacity} күрделілік бірлігі · {mine.length} ашық тапсырма</span><b>{me.kpi.loadPct}%</b></div>
          <Bar pct={me.kpi.loadPct ?? 0} tone={(me.kpi.loadPct ?? 0) > 100 ? 'over' : (me.kpi.loadPct ?? 0) > 80 ? 'warn' : undefined} />
          {(me.kpi.loadPct ?? 0) > 100 && <div className="small mt8" style={{ color: 'var(--danger)' }}>Жүктеме сыйымдылықтан асты — бас бухгалтерге қайта бөлу туралы хабар беріңіз.</div>}
        </Card>
      )}
      <div className="grid g2">
        <Card title={`Бүгінгі тапсырмалар (${todayList.length})`}><List items={todayList} empty="Бүгінге тапсырма жоқ" /></Card>
        <Card title={`Кешіккен жұмыстар (${overdue.length})`}><List items={overdue} empty="Кешіккен жұмыс жоқ" /></Card>
        <Card title={`Тексеруден қайтарылған (${returned.length})`}><List items={returned} empty="Қайтарылған жұмыс жоқ" /></Card>
        <Card title={`Клиент жауабын күтуде (${waiting.length})`}><List items={waiting} empty="Жоқ" /></Card>
        <Card title={`${monthLabel(prevMonth)}: жабылмаған кезеңдер`}>
          {closing.length ? closing.map(({ t, c }) => (
            <div key={t.id} className="mb8 click" style={{ cursor: 'pointer' }} onClick={() => { setSession({ tenantId: t.id }); go('/reports'); }}>
              <div className="row between small"><span>{t.name}</span><span>{c.readyPct}% {c.blockers.length > 0 && <Badge tone="warn">{c.blockers.length} кедергі</Badge>}</span></div>
              <Bar pct={c.readyPct} />
            </div>
          )) : <Empty>Барлық кезең жабылған</Empty>}
        </Card>
        <Card title={`Маған бекітілген, тапсырмасы жоқ мәселелер (${myFindings.length})`}>
          {myFindings.length ? (
            <table className="tbl small"><tbody>{myFindings.map((f) => <tr key={f.id} className="click" onClick={() => openFinding(f.id)}><td><b>{f.title}</b><div className="muted">{api.db.tenants.find((x) => x.id === f.tenantId)?.name}</div></td><td>{fmtDate(f.dueDate)}</td></tr>)}</tbody></table>
          ) : <Empty>Жоқ</Empty>}
        </Card>
      </div>
    </div>
  );
}
