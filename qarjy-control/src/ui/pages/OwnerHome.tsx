import { useApp } from '../ctx';
import { Badge, Card, Explain, FindingStatusBadge, KindBadge, Kzt, MetricStatusBadge, Forbidden, Empty, Bar } from '../components/ui';
import { CashChart, PlanFact } from '../components/charts';
import { fmtBp, fmtKzt, fmtKztShort, sum, type Money } from '../../domain/money';
import { fmtDate, fmtDateTime, diffDays, monthLabel, addDays } from '../../domain/periods';
import { OPEN_FINDING_STATUSES } from '../../domain/checks';
import type { Finding, ID } from '../../domain/types';
import { balanceAt, type MetricStatus } from '../../domain/finance';
import { TX_KIND_LABEL } from '../components/detail';
import { t } from '../i18n';
import type { ReactNode } from 'react';

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function Metric({ label, value, status, sub, onClick, explainKey, meta, unknownText, extra }: { label: string; value: Money | null; status: MetricStatus | 'stale'; sub?: ReactNode; onClick: () => void; explainKey: string; meta: string; unknownText?: string; extra?: ReactNode }) {
  return (
    <div className="card metric" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()} title="Басыңыз: қалай есептелді және бастапқы операциялар">
      <div className="label">
        <span>
          {label} <Explain k={explainKey} />
        </span>
        <MetricStatusBadge status={status} />
      </div>
      {value === null ? <div className="value unknown">{unknownText ?? 'Есеп толық емес'}</div> : <div className="value">{fmtKztShort(value)}</div>}
      {sub && <div className="sub">{sub}</div>}
      {extra}
      <div className="meta">{meta}</div>
    </div>
  );
}

export function issueTone(f: Finding, today: string): string {
  if (f.severity === 'critical' || (f.severity === 'high' && f.dueDate && f.dueDate < today)) return 'urgent';
  if (f.severity === 'high') return 'high';
  return '';
}

export function IssueCard({ f, compact }: { f: Finding; compact?: boolean }) {
  const { api, openFinding } = useApp();
  const today = api.today();
  const late = f.dueDate && f.dueDate < today;
  return (
    <div className={`issue ${issueTone(f, today)}`}>
      <div className="row between">
        <b style={{ cursor: 'pointer' }} onClick={() => openFinding(f.id)}>{f.title}</b>
        <div className="row">
          <KindBadge kind={f.kind} />
          <FindingStatusBadge s={f.status} />
        </div>
      </div>
      <dl className="chain">
        <dt>Не болды</dt>
        <dd>{f.whatHappened}</dd>
        {!compact && (
          <>
            <dt>Бизнеске әсері</dt>
            <dd>{f.businessImpact}</dd>
          </>
        )}
        <dt>Қандай әрекет</dt>
        <dd>{f.actionNeeded}</dd>
        <dt>Жауапты</dt>
        <dd>{api.userName(f.assigneeId)}</dd>
        <dt>Мерзімі</dt>
        <dd>
          {fmtDate(f.dueDate)} {late && <Badge tone="danger">кешікті</Badge>}
        </dd>
      </dl>
      <div className="row">
        <button className="btn sm" onClick={() => openFinding(f.id)}>Түсіндірме мен құжаттар →</button>
        {!f.taskId && api.can('tasks.create_from_issue', f.tenantId) && <button className="btn sm primary" onClick={() => openFinding(f.id)}>Бухгалтерге тапсыру</button>}
      </div>
    </div>
  );
}

export function OwnerHome({ tenantId }: { tenantId: ID }) {
  const { api, session, openDrill, openTask, setSession, go } = useApp();
  let F: ReturnType<typeof api.finance>;
  try {
    F = api.finance(tenantId, session.branchId, session.periodKey);
  } catch (e) {
    return <Forbidden message={(e as Error).message} />;
  }
  const lang = session.lang;
  const tenant = api.db.tenants.find((x) => x.id === tenantId)!;
  const branch = api.db.branches.find((b) => b.id === session.branchId);
  const today = api.today();
  const P = F.pnl;
  const PP = F.prevPnl;
  const per = lang === 'ru' ? F.period.labelRu : F.period.label;
  const src = F.freshness.connection ? `1С → ${F.freshness.connection.isMock ? 'MockConnector' : F.freshness.connection.method}` : 'Дереккөз жоқ';
  const upd = F.freshness.lastSuccessAt ? fmtDateTime(F.freshness.lastSuccessAt) : '—';
  const meta = `${per} · ${src} · ${upd}`;
  const balStatus: MetricStatus = F.reportStatus === 'final' ? 'final' : 'preliminary';
  const st = (s: MetricStatus): MetricStatus | 'stale' => (F.freshness.status === 'stale' && s !== 'incomplete' && s !== 'no_data' ? 'stale' : s);
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
  const salesDelta = pct(P.netSales, PP.netSales);
  const marginDelta = P.grossMarginBp !== null && PP.grossMarginBp !== null ? P.grossMarginBp - PP.grossMarginBp : null;
  const arTotal = sum(F.ar.map((d) => d.outstanding));
  const arOver = sum(F.ar.map((d) => d.overdue));
  const apTotal = sum(F.ap.map((d) => d.outstanding));
  const next14 = F.calendar.days.slice(0, 14);
  const out14 = next14.flatMap((d) => d.entries.filter((e) => e.direction === 'out'));
  const out14Contract = sum(out14.filter((e) => e.basis !== 'forecast').map((e) => e.amount));
  const out14Forecast = sum(out14.filter((e) => e.basis === 'forecast').map((e) => e.amount));
  const shortage = next14.find((d) => d.shortage);

  const findings = api.findings(tenantId).filter((f) => (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status));
  const top3 = findings
    .filter((f) => f.ownerVisible && (!session.branchId || !f.branchId || f.branchId === session.branchId))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.potentialImpact ?? 0) - (a.potentialImpact ?? 0))
    // Экранды бір түрлі ескертумен толтырмау: әр ережеден бір мәселе
    .filter((f, i, arr) => arr.findIndex((x) => x.ruleId === f.ruleId) === i)
    .slice(0, 3);
  const decisions = api.tasks(tenantId).filter((x) => x.needsOwnerDecision && !x.ownerDecision);
  const tasks = api.tasks(tenantId);
  const curMonth = today.slice(0, 7);
  const monthTasks = tasks.filter((x) => x.plannedDue.startsWith(curMonth) && x.status !== 'cancelled');
  const overdue = tasks.filter((x) => !['done', 'cancelled'].includes(x.status) && x.plannedDue < today);
  const waitingClient = overdue.filter((x) => x.status === 'waiting_client');
  const prevMonth = addDays(`${curMonth}-01`, -1).slice(0, 7);
  const close = api.periodClose(tenantId, prevMonth);
  const usage = api.usage(tenantId, curMonth);

  return (
    <div className="col gap16">
      <div className="row between">
        <div>
          <h1>{tenant.name}{branch ? ` · ${branch.name}` : ''}</h1>
          <div className="muted small">
            {per} · Кезең: {fmtDate(F.period.from)}–{fmtDate(F.period.to)}
            {F.effectiveTo < F.period.to && ` · дерек ${fmtDate(F.effectiveTo)} дейін`}
          </div>
        </div>
        <div className="row">
          <Badge tone={F.reportStatus === 'final' ? 'ok' : 'info'}>{F.reportStatus === 'final' ? t(lang, 'final') : t(lang, 'preliminary')}</Badge>
          <Badge tone="outline">DEMO деректер</Badge>
        </div>
      </div>

      {F.freshness.status === 'stale' && (
        <div className="callout warn">
          ⚠ Деректер ескі: 1С-тен соңғы сәтті синхрондау {upd} ({F.freshness.hours} сағат бұрын). Көрсеткіштер осы уақытқа дейінгі дерекпен есептелген. Жауапты: интегратор. <a href="#/integrations">Интеграция журналы →</a>
        </div>
      )}
      {!F.hasData && <div className="callout warn">Бұл компания үшін 1С деректері әлі жүктелмеген. Көрсеткіштер «Дерек жоқ» болып көрсетіледі — нөл емес.</div>}
      {F.reportStatus !== 'final' && F.hasData && (
        <div className="callout info small">
          «Алдын ала есеп»: кезеңдегі ай(лар) жабылмаған ({P.openMonths.map((m) => monthLabel(m)).join(', ')}). Сандар ай жабылғанда өзгеруі мүмкін.
        </div>
      )}

      <div className="grid g4">
        <Metric
          label={t(lang, 'sales')}
          value={F.hasData ? P.netSales : null}
          unknownText="Дерек жоқ"
          status={st(F.hasData ? (P.allMonthsClosed ? 'final' : 'preliminary') : 'no_data')}
          explainKey="sales"
          meta={meta}
          sub={salesDelta !== null && <span>Алдыңғы кезеңмен: <b className={salesDelta >= 0 ? 'delta-up' : 'delta-down'}>{salesDelta > 0 ? '+' : ''}{salesDelta}%</b> ({fmtKztShort(PP.netSales)})</span>}
          onClick={() => openDrill({ title: 'Сатылым', tenantId, explainKey: 'sales', formula: 'Таза сатылым = Сатылым − Қайтарымдар', lines: [{ label: 'Сатылым', value: P.grossSales }, { label: 'Қайтарымдар', value: -P.returns }, { label: 'Таза сатылым', value: P.netSales, strong: true }], txIds: [...P.txIds.sales, ...P.txIds.returns], meta: { period: per, source: src, updated: upd } })}
        />
        <Metric
          label={t(lang, 'grossProfit')}
          value={P.grossProfit.value}
          unknownText={P.grossProfit.status === 'no_data' ? 'Дерек жоқ' : undefined}
          status={st(P.grossProfit.status)}
          explainKey="grossProfit"
          meta={meta}
          sub={<span>Маржа <b>{fmtBp(P.grossMarginBp)}</b>{marginDelta !== null && <> · <b className={marginDelta >= 0 ? 'delta-up' : 'delta-down'}>{marginDelta > 0 ? '+' : ''}{(marginDelta / 100).toFixed(1)} п.п.</b></>}{P.missingCost.count > 0 && <> · <span style={{ color: 'var(--warn)' }}>{P.missingCost.count} сатылымның өзіндік құны жоқ</span></>}</span>}
          onClick={() => openDrill({ title: 'Жалпы пайда және маржа', tenantId, explainKey: 'grossProfit', formula: 'Жалпы пайда = Таза сатылым (өзіндік құны белгілі) − Өзіндік құн', lines: [{ label: 'Таза сатылым', value: P.netSales }, ...(P.missingCost.count ? [{ label: `Өзіндік құны белгісіз сатылым (есептен тыс)`, value: -P.missingCost.salesAmount, note: 'Бұл сатылымдардың пайдасы белгісіз — 0 деп есептелмейді' }] : []), { label: 'Өзіндік құн', value: -P.cogs }, { label: 'Жалпы пайда', value: P.grossProfit.value, strong: true }], notes: P.grossProfit.reasons, txIds: [...P.txIds.sales, ...P.txIds.returns], meta: { period: per, source: src, updated: upd } })}
        />
        <Metric
          label={t(lang, 'opProfit')}
          value={P.operatingProfit.value}
          unknownText="Дерек жоқ"
          status={st(P.operatingProfit.status)}
          explainKey="opProfit"
          meta={meta}
          sub={P.operatingProfit.status === 'incomplete' ? <span style={{ color: 'var(--warn)' }}>{P.operatingProfit.reasons[0]}</span> : <span>Шығындар: {fmtKztShort(P.opex)}</span>}
          onClick={() => openDrill({ title: 'Операциялық пайда', tenantId, explainKey: 'opProfit', formula: 'Операциялық пайда = Жалпы пайда − Операциялық шығындар', lines: [{ label: 'Жалпы пайда', value: P.grossProfit.value }, ...P.opexByCategory.map((c) => ({ label: `− ${CAT[c.category]}`, value: -c.amount })), { label: 'Операциялық пайда', value: P.operatingProfit.value, strong: true }], notes: P.operatingProfit.reasons, txIds: P.txIds.opex, meta: { period: per, source: src, updated: upd } })}
        />
        <Metric
          label={t(lang, 'netProfit')}
          value={P.netProfit.value}
          status={st(P.netProfit.status)}
          explainKey="netProfit"
          meta={meta}
          sub={P.netProfit.value === null ? <span>{P.netProfit.reasons.slice(-1)[0]}</span> : <span>Табыс салығы (бухгалтер есептеген): {fmtKztShort(P.incomeTax.value)}</span>}
          onClick={() => openDrill({ title: 'Есептелген таза пайда', tenantId, explainKey: 'netProfit', formula: 'Таза пайда = Операциялық пайда + Басқа кірістер − Басқа шығыстар − Табыс салығы', lines: [{ label: 'Операциялық пайда', value: P.operatingProfit.value }, { label: '+ Басқа кірістер', value: P.otherIncome }, { label: '− Басқа шығыстар', value: -P.otherExpense }, { label: '− Табыс салығы', value: P.incomeTax.value === null ? null : -P.incomeTax.value }, { label: 'Таза пайда', value: P.netProfit.value, strong: true }], notes: P.netProfit.reasons, txIds: P.txIds.other, meta: { period: per, source: src, updated: upd } })}
        />
        <Metric
          label={t(lang, 'cash')}
          value={F.hasData ? F.cash.closing : null}
          unknownText="Дерек жоқ"
          status={F.hasData ? st(balStatus) : 'no_data'}
          explainKey="cash"
          meta={`${fmtDate(F.period.to)} соңы · ${src} · ${upd}`}
          sub={<span>Кезең басы {fmtKztShort(F.cash.opening)} · өзгеріс <b className={F.cash.closing >= F.cash.opening ? 'delta-up' : 'delta-down'}>{fmtKztShort(F.cash.closing - F.cash.opening)}</b>{F.cash.bankOnlyCompanyLevel && <><br />Филиал сүзгісі: тек филиал кассасы (банк компания деңгейінде)</>}</span>}
          onClick={() => openDrill({ title: 'Банк пен кассадағы ақша', tenantId, explainKey: 'cash', formula: 'Кезең соңы = Кезең басы + Түсімдер − Төлемдер (ішкі аударым кіріс емес)', lines: [{ label: 'Кезең басындағы ақша', value: F.cash.opening }, ...F.cash.inflows.map((l) => ({ label: `+ ${TX_KIND_LABEL[l.kind]}`, value: l.amount })), ...F.cash.outflows.map((l) => ({ label: `− ${TX_KIND_LABEL[l.kind]}`, value: -l.amount })), ...(F.cash.transfersIn ? [{ label: '+ Ішкі аударым (сүзгіден тыс шоттан)', value: F.cash.transfersIn }] : []), ...(F.cash.transfersOut ? [{ label: '− Ішкі аударым (компания банкіне)', value: -F.cash.transfersOut }] : []), { label: 'Кезең соңындағы ақша', value: F.cash.closing, strong: true }, ...F.cash.accounts.map((a) => ({ label: `   оның ішінде: ${a.name}`, value: balanceAt(api.db, [a.id], F.period.to) as Money | null }))], notes: [F.cash.reconciles ? `✓ Тексеру: кезең басы + түсім − төлем = кезең соңы. Ішкі аударымдар (${fmtKzt(F.cash.internalTransfers)}) кіріс ретінде есептелмеді.` : '✗ Сәйкессіздік!'], meta: { period: per, source: src, updated: upd } })}
        />
        <Metric
          label={t(lang, 'ar')}
          value={F.hasData && (F.ar.length || tenant.industry === 'wholesale') ? arTotal : null}
          unknownText={F.hasData ? 'Қолданылмайды (бөлшек сауда)' : 'Дерек жоқ'}
          status={F.hasData ? st(balStatus) : 'no_data'}
          explainKey="ar"
          meta={`${fmtDate(F.effectiveTo)} · FIFO · ${upd}`}
          sub={arOver > 0 ? <span>Мерзімі өткен: <b style={{ color: 'var(--danger)' }}>{fmtKztShort(arOver)}</b> · ең үлкені {F.ar[0]?.name}</span> : <span>Мерзімі өткен қарыз жоқ</span>}
          onClick={() => go('/finance?tab=debts')}
        />
        <Metric label={t(lang, 'ap')} value={F.hasData ? apTotal : null} unknownText="Дерек жоқ" status={F.hasData ? st(balStatus) : 'no_data'} explainKey="ap" meta={`${fmtDate(F.effectiveTo)} · ${upd}`} sub={<span>{F.ap.filter((d) => d.outstanding > 0).length} жеткізуші · мерзімі өткен {fmtKztShort(sum(F.ap.map((d) => d.overdue)))}</span>} onClick={() => go('/finance?tab=debts')} />
        <Metric
          label={t(lang, 'upcoming')}
          value={F.hasData ? out14Contract + out14Forecast : null}
          unknownText="Дерек жоқ"
          status={F.hasData ? st(balStatus) : 'no_data'}
          explainKey="upcoming"
          meta={`${fmtDate(next14[0]?.date)}–${fmtDate(next14[13]?.date)} · болжам + шарт`}
          sub={<span>Шарт бойынша {fmtKztShort(out14Contract)} · болжам {fmtKztShort(out14Forecast)}{shortage ? <><br /><b style={{ color: 'var(--danger)' }}>Ақша жетіспеуі ықтимал: {fmtDate(shortage.date)}</b></> : <><br />Болжам бойынша жетіспеу жоқ</>}</span>}
          onClick={() => go('/finance?tab=calendar')}
        />
      </div>

      <div className="grid g3">
        <Card title="Ақша қалдығы" sub={`Күн сайынғы қалдық · ${per}${branch ? ' · тек филиал кассасы' : ''}`} className="span2" actions={<a className="small" href="#/finance?tab=cash">Толығырақ →</a>}>
          {F.hasData ? <CashChart data={F.daily} /> : <Empty>Дерек жоқ — 1С қосылғаннан немесе CSV импорттан кейін көрінеді</Empty>}
        </Card>
        <Card title="Жоспар және нақты" sub={F.plan?.prorated ? 'Жоспар кезең күніне пропорционал бөлінді' : per}>
          {F.plan ? (
            <PlanFact rows={[{ label: 'Сатылым', plan: F.plan.sales.plan, fact: F.plan.sales.fact }, { label: 'Жалпы пайда', plan: F.plan.grossProfit.plan, fact: F.plan.grossProfit.fact }, { label: 'Операциялық шығын', plan: F.plan.opex.plan, fact: F.plan.opex.fact, lowerIsBetter: true }]} />
          ) : (
            <Empty>Бұл кезеңге жоспар енгізілмеген</Empty>
          )}
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Назар аударуды қажет ететін 3 мәселе" actions={<a className="small" href="#/issues">Барлығы ({findings.length}) →</a>}>
          <div className="col">{top3.length ? top3.map((f) => <IssueCard key={f.id} f={f} />) : <Empty>Шұғыл мәселе жоқ</Empty>}</div>
        </Card>
        <div className="col gap16">
          <Card title="Сіздің шешіміңізді күтетін сұрақтар" sub="Бухгалтер жауабыңызсыз жалғастыра алмайды">
            {decisions.length ? (
              <div className="col">
                {decisions.map((d) => (
                  <div key={d.id} className="issue" style={{ cursor: 'pointer' }} onClick={() => openTask(d.id)}>
                    <div className="row between">
                      <b>{d.title}</b>
                      <Badge tone={d.plannedDue < today ? 'danger' : 'warn'}>мерзімі {fmtDate(d.plannedDue)}</Badge>
                    </div>
                    <div className="small muted">{d.description}</div>
                    <div className="small">Сұраған: {api.userName(d.assigneeId)} · <a>Жауап беру →</a></div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Шешім күтіп тұрған сұрақ жоқ</Empty>
            )}
          </Card>
          <Card title="Бухгалтерлік қызметтің орындалуы" sub={`${monthLabel(curMonth)} · біздің команда`}>
            <table className="tbl small">
              <tbody>
                <tr><td>Осы айдағы жұмыстар</td><td className="right num">{monthTasks.filter((x) => x.status === 'done').length} / {monthTasks.length} қабылданды</td></tr>
                <tr><td>Мерзімі өткен жұмыстар</td><td className="right">{overdue.length ? <a onClick={() => go('/tasks?filter=overdue')}>{overdue.length}</a> : 0}{waitingClient.length > 0 && <span className="muted"> (оның {waitingClient.length} — сіздің тараптан жауап күтуде)</span>}</td></tr>
                <tr><td>{monthLabel(prevMonth)} айын жабу</td><td className="right">{close.pc.status === 'closed' ? <Badge tone="ok">жабылды {fmtDate(close.pc.closedAt?.slice(0, 10))}</Badge> : <><Badge tone="info">чек-лист {close.readyPct}%</Badge> {close.blockers.length > 0 && <Badge tone="warn">{close.blockers.length} кедергі</Badge>}</>}</td></tr>
                <tr><td>Келісілген көлем (күрделілік бірлігі)</td><td className="right num">{usage.units} / {usage.limit}</td></tr>
              </tbody>
            </table>
            <div className="mt8"><Bar pct={usage.limit ? (usage.units / usage.limit) * 100 : 0} tone={usage.units > usage.limit ? 'over' : undefined} /></div>
            {usage.over > 0 && <div className="small mt8 muted">Лимиттен тыс: {usage.over} бірлік. Қосымша төлем тек сіздің бекітуіңізбен есептеледі.</div>}
          </Card>
        </div>
      </div>

      {F.branches.length > 1 && (
        <Card title="Филиалдар салыстыруы" sub={`${per} · жолды басып сүзгіні қолданыңыз`}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Филиал</th>
                  <th className="right">Сатылым</th>
                  <th className="right">Маржа</th>
                  <th className="right">Жалпы пайда</th>
                  <th className="right">Шығын</th>
                  <th className="right">Операциялық пайда</th>
                  <th className="right">Тауар қалдығы <Explain k="inventory" /></th>
                </tr>
              </thead>
              <tbody>
                {F.branches.map((b) => (
                  <tr key={b.branch.id} className="click" onClick={() => setSession({ branchId: b.branch.id })} style={session.branchId === b.branch.id ? { background: 'var(--brand-soft)' } : undefined}>
                    <td>{b.branch.name}</td>
                    <td className="right"><Kzt v={b.netSales} short /></td>
                    <td className="right num">{fmtBp(b.marginBp)}</td>
                    <td className="right"><Kzt v={b.grossProfit.value} short /></td>
                    <td className="right"><Kzt v={b.opex} short /></td>
                    <td className="right">{b.operatingProfit.status === 'incomplete' ? <span><Kzt v={b.operatingProfit.value} short /> <Badge tone="warn" title={b.operatingProfit.reasons.join('; ')}>толық емес</Badge></span> : <Kzt v={b.operatingProfit.value} short />}</td>
                    <td className="right"><Kzt v={b.inventory} short /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted mt8">Тауар қалдығы — ақша емес. Ақшаға айналу үшін сатылуы керек.</div>
        </Card>
      )}

      <Card title="Дерек сапасы" sub="Бір «денсаулық пайызы» есептемейміз — әр компонент жеке" actions={<Explain k="quality" />}>
        <div className="grid g4">
          <div><div className="muted small">Ашық мәселелер</div><b>{findings.length}</b> <span className="small muted">(жоғары: {findings.filter((f) => f.severity === 'high').length})</span></div>
          <div><div className="muted small">AI күмәндары (тексерілуде)</div><b>{findings.filter((f) => f.kind === 'ai').length}</b></div>
          <div><div className="muted small">Дерек жаңалығы</div><b>{F.freshness.status === 'stale' ? `${F.freshness.hours} сағ бұрын` : F.freshness.status === 'fresh' ? 'Жаңа' : 'Қосылмаған'}</b></div>
          <div><div className="muted small">Ең ескі ашық мәселе</div><b>{findings.length ? `${Math.max(...findings.map((f) => diffDays(today, f.detectedAt.slice(0, 10))))} күн` : '—'}</b></div>
        </div>
      </Card>
    </div>
  );
}

export const CAT: Record<string, string> = { rent: 'Жалдау', salary: 'Жалақы', utilities: 'Коммуналдық', marketing: 'Маркетинг', logistics: 'Логистика', bank_fees: 'Банк комиссиясы', other: 'Басқа шығын' };
