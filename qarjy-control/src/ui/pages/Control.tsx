import { useApp } from '../ctx';
import { Badge, Bar, Card, Empty, FindingStatusBadge, Kzt, SeverityBadge, Forbidden } from '../components/ui';
import { OPEN_FINDING_STATUSES, RULES } from '../../domain/checks';
import { addDays, diffDays, fmtDate, monthLabel } from '../../domain/periods';

export function ControlPage() {
  const { api, openTask, openFinding, setSession, go } = useApp();
  const today = api.today();
  const tenants = api.tenants().filter((t) => api.can('findings.read', t.id));
  if (!tenants.length) return <Forbidden message="Бақылау орталығына рұқсат жоқ" />;
  const tasks = api.tasks();
  const toReview = tasks.filter((t) => t.status === 'in_review' && api.canReviewTask(t));
  const findings = tenants.flatMap((t) => api.findings(t.id));
  const open = findings.filter((f) => (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status));
  const risky = findings.filter((f) => ['fix_proposed', 'approved'].includes(f.status) && (f.severity === 'high' || f.severity === 'critical' || (f.potentialImpact ?? 0) >= 50_000_000));
  const old = open.filter((f) => diffDays(today, f.detectedAt.slice(0, 10)) > 7).sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  let team: ReturnType<typeof api.team> = [];
  try {
    team = api.team(`month:${today.slice(0, 7)}`);
  } catch {
    /* бухгалтерге тек өзі */
  }
  const byRule = RULES.map((r) => ({ r, n: findings.filter((f) => f.ruleId === r.id && f.status !== 'not_an_error').length, fp: findings.filter((f) => f.ruleId === r.id && f.status === 'not_an_error').length, tenants: new Set(findings.filter((f) => f.ruleId === r.id).map((f) => f.tenantId)).size })).filter((x) => x.n + x.fp > 0).sort((a, b) => b.n - a.n);
  const returns = api.db.reviews.filter((r) => r.decision === 'returned' && tenants.some((t) => t.id === r.tenantId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  return (
    <div className="col gap16">
      <h1>Бас бухгалтердің бақылау орталығы</h1>
      <div className="grid g4">
        <Card><div className="muted small">Бекітуді күтуде</div><h2>{toReview.length}</h2></Card>
        <Card><div className="muted small">Тәуекелі жоғары түзетулер</div><h2>{risky.length}</h2></Card>
        <Card><div className="muted small">Ашық мәселелер</div><h2>{open.length}</h2></Card>
        <Card><div className="muted small">7 күннен ескі мәселелер</div><h2>{old.length}</h2></Card>
      </div>
      <div className="grid g2">
        <Card title="Бекітуді күтіп тұрған жұмыстар">
          {toReview.length ? (
            <table className="tbl small">
              <tbody>
                {toReview.map((t) => (
                  <tr key={t.id} className="click" onClick={() => openTask(t.id)}>
                    <td><b>{t.title}</b><div className="muted">{api.db.tenants.find((x) => x.id === t.tenantId)?.name} · {api.userName(t.assigneeId)}</div></td>
                    <td>{t.evidence.length} дәлел</td>
                    <td className="num">{fmtDate(t.plannedDue)}</td>
                    <td><a>Тексеру →</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Тексеруді күтіп тұрған жұмыс жоқ</Empty>}
        </Card>
        <Card title="Тәуекелі жоғары түзетулер" sub="Бекіту мен қайта тексеруді қажет етеді">
          {risky.length ? (
            <table className="tbl small">
              <tbody>
                {risky.map((f) => (
                  <tr key={f.id} className="click" onClick={() => openFinding(f.id)}>
                    <td><b>{f.title}</b><div className="muted">{api.db.tenants.find((x) => x.id === f.tenantId)?.name}</div></td>
                    <td><SeverityBadge s={f.severity} /></td>
                    <td className="right"><Kzt v={f.potentialImpact} short /></td>
                    <td><FindingStatusBadge s={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Жоқ</Empty>}
        </Card>
        <Card title={`Ай жабу дайындығы · ${monthLabel(prevMonth)}`}>
          <table className="tbl small">
            <tbody>
              {tenants.map((t) => {
                const c = api.periodClose(t.id, prevMonth);
                return (
                  <tr key={t.id} className="click" onClick={() => { setSession({ tenantId: t.id }); go('/reports'); }}>
                    <td>{t.name}</td>
                    <td style={{ width: 140 }}>{c.pc.status === 'closed' ? <Badge tone="ok">Жабылды</Badge> : <Bar pct={c.readyPct} />}</td>
                    <td className="num">{c.pc.status === 'closed' ? fmtDate(c.pc.closedAt?.slice(0, 10)) : `${c.readyPct}%`}</td>
                    <td>{c.blockers.length > 0 && <Badge tone="warn">{c.blockers.length} кедергі</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Клиенттер бойынша есеп сапасы" sub="Компоненттер бөлек — біріктірілген индекс жоқ">
          <table className="tbl small">
            <thead><tr><th>Клиент</th><th>Ашық</th><th>Жоғары</th><th>AI күмәні</th><th>Дерек</th></tr></thead>
            <tbody>
              {tenants.map((t) => {
                const o = open.filter((f) => f.tenantId === t.id);
                const fr = api.connections().find((c) => c.tenant.id === t.id)?.freshness;
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{o.length}</td>
                    <td>{o.filter((f) => f.severity === 'high' || f.severity === 'critical').length}</td>
                    <td>{o.filter((f) => f.kind === 'ai').length}</td>
                    <td>{fr?.status === 'stale' ? <Badge tone="warn">{fr.hours} сағ ескі</Badge> : fr?.status === 'fresh' ? <Badge tone="ok">жаңа</Badge> : <Badge>жоқ</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Бухгалтерлердің жүктемесі" sub="Осы ай · күрделілік бірлігі">
          {team.map(({ user, kpi }) => (
            <div key={user.id} className="mb8">
              <div className="row between small"><span>{user.name}</span><span className="num">{kpi.openUnits}/{kpi.capacity} · <b>{kpi.loadPct}%</b> · кешіккен {kpi.overdue.length}</span></div>
              <Bar pct={kpi.loadPct ?? 0} tone={(kpi.loadPct ?? 0) > 100 ? 'over' : (kpi.loadPct ?? 0) > 80 ? 'warn' : undefined} />
            </div>
          ))}
          <a className="small" href="#/team">Команда және KPI →</a>
        </Card>
        <Card title="Ұзақ уақыт шешілмеген мәселелер">
          {old.length ? (
            <table className="tbl small">
              <tbody>
                {old.slice(0, 8).map((f) => (
                  <tr key={f.id} className="click" onClick={() => openFinding(f.id)}>
                    <td><b>{f.title}</b><div className="muted">{api.userName(f.assigneeId)}</div></td>
                    <td className="num">{diffDays(today, f.detectedAt.slice(0, 10))} күн</td>
                    <td><FindingStatusBadge s={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Жоқ</Empty>}
        </Card>
        <Card title="Қайталанатын қате себептері" className="span2">
          <div className="grid g2">
            <table className="tbl small">
              <thead><tr><th>Ереже</th><th>Мәселелер</th><th>Жалған дабыл</th><th>Клиенттер</th></tr></thead>
              <tbody>
                {byRule.map((x) => <tr key={x.r.id}><td>{x.r.code} · {x.r.name} {x.r.kind === 'ai' && <Badge tone="ai">AI</Badge>}</td><td>{x.n}</td><td>{x.fp}</td><td>{x.tenants}</td></tr>)}
              </tbody>
            </table>
            <div>
              <h4 className="mb8">Соңғы кері қайтару себептері</h4>
              {returns.map((r) => (
                <div key={r.id} className="small mb8">
                  <b>{api.db.tasks.find((t) => t.id === r.taskId)?.title}</b> — {r.note} <span className="muted">({api.userName(api.db.tasks.find((t) => t.id === r.taskId)?.assigneeId)})</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
