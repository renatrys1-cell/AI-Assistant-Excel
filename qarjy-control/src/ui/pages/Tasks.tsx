import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, Empty, Modal, Tabs, TaskStatusBadge } from '../components/ui';
import { AssignForm, COMPLEXITY_LABEL } from '../components/detail';
import { KANBAN_COLUMNS, TASK_STATUS_LABEL } from '../../domain/workflow';
import { fmtDate } from '../../domain/periods';
import type { ID, Task, TaskStatus } from '../../domain/types';

export function TasksPage({ tenantId }: { tenantId: ID | null }) {
  const { api, openTask, run, route, session, setSession } = useApp();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [scope, setScope] = useState<'mine' | 'company' | 'all'>(api.allRoles().includes('accountant') ? 'mine' : 'company');
  const [status, setStatus] = useState<'' | TaskStatus | 'open' | 'overdue'>(route.query.get('filter') === 'overdue' ? 'overdue' : 'open');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<ID>>(new Set());
  const [bulkTo, setBulkTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const today = api.today();
  const all = api.tasks(scope === 'all' ? null : tenantId);
  const list = all
    .filter((t) => scope !== 'mine' || t.assigneeId === api.userId || t.reviewerId === api.userId || t.clientAssigneeId === api.userId)
    .filter((t) => (status === '' ? true : status === 'open' ? !['done', 'cancelled'].includes(t.status) : status === 'overdue' ? !['done', 'cancelled'].includes(t.status) && t.plannedDue < today : t.status === status))
    .filter((t) => !q || `${t.title} ${t.opType}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.plannedDue.localeCompare(b.plannedDue));
  const canAssign = tenantId ? api.can('tasks.assign', tenantId) : false;
  const dups = canAssign ? api.duplicates() : [];
  const assignees = tenantId ? api.staff(tenantId).filter((s) => s.roles.includes('accountant') || s.roles.includes('chief_accountant')) : [];
  const late = (t: Task) => !['done', 'cancelled'].includes(t.status) && t.plannedDue < today;
  const toggle = (id: ID) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="col gap16">
      <div className="row between">
        <h1>Тапсырмалар</h1>
        <div className="row">
          <Tabs value={view} onChange={setView} items={[['table', 'Кесте'], ['kanban', 'Kanban']]} />
          <Tabs value={session.density} onChange={(d) => setSession({ density: d })} items={[['comfortable', 'Кең'], ['compact', 'Тығыз']]} />
          {tenantId && api.can('tasks.create_from_issue', tenantId) && <button className="btn primary" onClick={() => setCreating(true)}>+ Тапсырма</button>}
        </div>
      </div>
      {dups.length > 0 && (
        <div className="callout warn">
          ⚠ Қайталанған тапсырма анықталды: {dups.map((d) => `«${d.tasks[0].title}» — ${d.tasks.map((t) => api.userName(t.assigneeId)).join(', ')}`).join('; ')}
        </div>
      )}
      <Card>
        <div className="row mb8">
          <Tabs value={scope} onChange={setScope} items={[['mine', 'Менікі'], ['company', 'Таңдалған компания'], ['all', 'Барлық компания']]} />
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Ашық</option>
            <option value="overdue">Мерзімі өткен</option>
            <option value="">Барлығы</option>
            {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="Іздеу…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{list.length} тапсырма</span>
        </div>
        {canAssign && sel.size > 0 && (
          <div className="callout info row mb8">
            Таңдалды: {sel.size} · Жаппай қайта тағайындау:
            <select value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
              <option value="">— орындаушы —</option>
              {assignees.map((s) => <option key={s.user.id} value={s.user.id}>{s.user.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!bulkTo} onClick={() => run(() => api.bulkAssign([...sel], bulkTo), 'Қайта тағайындалды') && setSel(new Set())}>Қолдану</button>
            <button className="btn sm" onClick={() => setSel(new Set())}>Тазалау</button>
          </div>
        )}
        {list.length === 0 ? (
          <Empty>Тапсырма жоқ</Empty>
        ) : view === 'table' ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {canAssign && <th></th>}
                  <th>Тапсырма</th>
                  <th>Компания</th>
                  <th>Орындаушы</th>
                  <th>Тексеруші</th>
                  <th>Күрделілік</th>
                  <th>Мерзімі</th>
                  <th>Мәртебе</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
                    {canAssign && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label="таңдау" /></td>}
                    <td>
                      <b>{t.title}</b>
                      <div className="muted small">{t.opType}{t.waitReason ? ` · күту: ${t.waitReason}` : ''}</div>
                    </td>
                    <td className="small">{api.db.tenants.find((x) => x.id === t.tenantId)?.name.replace(' (demo)', '')}</td>
                    <td className="small">{api.userName(t.assigneeId)}</td>
                    <td className="small">{api.userName(t.reviewerId)}</td>
                    <td className="small">{COMPLEXITY_LABEL[t.complexity]}</td>
                    <td className="small num">{fmtDate(t.plannedDue)} {late(t) && <Badge tone="danger">кешікті</Badge>}</td>
                    <td>
                      <TaskStatusBadge s={t.status} />
                      {t.needsOwnerDecision && !t.ownerDecision && <div><Badge tone="warn">шешім күтеді</Badge></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kanban">
            {KANBAN_COLUMNS.map((c) => (
              <div key={c} className="kcol">
                <div className="row between small"><b>{TASK_STATUS_LABEL[c]}</b><span className="muted">{list.filter((t) => t.status === c).length}</span></div>
                {list.filter((t) => t.status === c).map((t) => (
                  <div key={t.id} className="kcard" onClick={() => openTask(t.id)}>
                    <b>{t.title}</b>
                    <span className="muted tiny">{api.db.tenants.find((x) => x.id === t.tenantId)?.name.replace(' (demo)', '')} · {api.userName(t.assigneeId)}</span>
                    <span className="row tiny">{fmtDate(t.plannedDue)} {late(t) && <Badge tone="danger">кешікті</Badge>} <Badge tone="outline">{COMPLEXITY_LABEL[t.complexity]}</Badge></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
      {creating && tenantId && (
        <Modal title="Жаңа тапсырма" onClose={() => setCreating(false)}>
          <label className="field">Атауы *<input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></label>
          <AssignForm
            tenantId={tenantId}
            onCancel={() => setCreating(false)}
            onSubmit={(p) => {
              const r = run(() => api.createTask(tenantId, { title: newTitle, description: p.note, opType: 'Қолмен жасалған', assigneeId: p.assigneeId, reviewerId: p.reviewerId, plannedDue: p.plannedDue, complexity: p.complexity, source: 'manual' }), 'Тапсырма жасалды');
              if (r) setCreating(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
