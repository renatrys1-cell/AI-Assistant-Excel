import { useState } from 'react';
import { useApp, type DrillSpec } from '../ctx';
import { Badge, Explain, FindingStatusBadge, KindBadge, Kzt, Modal, SeverityBadge, TaskStatusBadge, DemoBadge } from './ui';
import { fmtKzt, tenge, sum } from '../../domain/money';
import { fmtDate, fmtDateTime, addDays } from '../../domain/periods';
import { FINDING_FLOW, FINDING_STATUS_LABEL, TASK_STATUS_LABEL } from '../../domain/workflow';
import type { Complexity, FindingStatus, ID, TaskEvidence, TaskStatus, TxKind, DocType } from '../../domain/types';
import { RULES } from '../../domain/checks';

export const TX_KIND_LABEL: Record<TxKind | 'sale_cash' | 'transfer_in' | 'transfer_out', string> = {
  sale: 'Сатылым', sale_cash: 'Сатылымнан түсім (қолма-қол/карта)', sale_return: 'Қайтарым', purchase: 'Тауар сатып алу', customer_payment: 'Клиенттен түсім', supplier_payment: 'Жеткізушіге төлем',
  expense: 'Операциялық шығын', tax_payment: 'Салық төлемі', other_income: 'Басқа кіріс', other_expense: 'Басқа шығыс', transfer: 'Ішкі аударым', transfer_in: 'Ішкі аударым (кіріс)', transfer_out: 'Ішкі аударым (шығыс)',
  owner_contribution: 'Иесінің салымы', owner_withdrawal: 'Иесінің алымы', owner_personal_expense: 'Иесінің жеке шығыны', unclassified_payment: 'Жіктелмеген төлем',
};

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  retail_receipt_z: 'Z-есеп (бөлшек сатылым)', sales_invoice: 'Жүкқұжат (сатылым)', sales_return: 'Қайтарым', purchase_invoice: 'Кіріс жүкқұжаты', bank_statement_line: 'Банк көшірмесі', cash_order: 'Кассалық ордер',
  payroll: 'Жалақы ведомосы', service_act: 'Қызмет актісі', inventory_count: 'Санақ актісі', transfer_order: 'Инкассация', other: 'Басқа',
};

export const COMPLEXITY_LABEL: Record<Complexity, string> = { simple: 'Қарапайым', standard: 'Стандарт', complex: 'Күрделі' };

export function TxTable({ tenantId, txIds, limit = 150 }: { tenantId: ID; txIds: ID[]; limit?: number }) {
  const { api, openDoc } = useApp();
  let txs: ReturnType<typeof api.transactions> = [];
  try {
    txs = api.transactions(tenantId, txIds).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return <div className="callout warn">Операцияларды көруге рұқсат жоқ.</div>;
  }
  if (!txs.length) return <div className="muted small">Байланысты операция жоқ.</div>;
  return (
    <div className="tbl-wrap" style={{ maxHeight: 320 }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Күні</th>
            <th>Түрі</th>
            <th>Сипаттама</th>
            <th className="right">Сома</th>
            <th className="right">Өзіндік құн</th>
            <th>Құжат</th>
          </tr>
        </thead>
        <tbody>
          {txs.slice(0, limit).map((t) => (
            <tr key={t.id}>
              <td className="num">{fmtDate(t.date)}</td>
              <td>{TX_KIND_LABEL[t.kind]}</td>
              <td>{t.description}</td>
              <td className="right"><Kzt v={t.amount} /></td>
              <td className="right">{t.kind === 'sale' ? t.cost === null || t.cost === undefined ? <Badge tone="warn">белгісіз</Badge> : <Kzt v={t.cost} /> : ''}</td>
              <td>{t.docId ? <a onClick={() => openDoc(tenantId, t.docId!)}>ашу →</a> : <span className="muted small">құжатсыз</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {txs.length > limit && <div className="muted small mt8">Алғашқы {limit} операция көрсетілді (барлығы {txs.length}). Толық тізім — «Құжаттар» бөлімінде.</div>}
    </div>
  );
}

export function DrillModal({ d, onClose }: { d: DrillSpec; onClose: () => void }) {
  return (
    <Modal title={d.title} onClose={onClose} wide>
      {d.meta && (
        <div className="row small muted">
          <span>Кезең: <b>{d.meta.period}</b></span>·<span>Дереккөз: {d.meta.source}</span>·<span>Жаңартылды: {d.meta.updated}</span>
          {d.meta.status && <Badge tone="info">{d.meta.status}</Badge>}
          {d.explainKey && <Explain k={d.explainKey} />}
        </div>
      )}
      {d.formula && <div className="callout info"><b>Қалай есептелді:</b> {d.formula}</div>}
      {d.lines && (
        <table className="tbl">
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i} className={l.strong ? 'total' : ''}>
                <td>
                  {l.label}
                  {l.note && <div className="muted small">{l.note}</div>}
                </td>
                <td className="right">{l.value === null ? <Badge tone="warn">белгісіз</Badge> : <Kzt v={l.value} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.notes?.map((n, i) => <div key={i} className="callout warn">{n}</div>)}
      {d.txIds && (
        <>
          <h3>Бастапқы операциялар ({d.txIds.length})</h3>
          <TxTable tenantId={d.tenantId} txIds={d.txIds} />
        </>
      )}
    </Modal>
  );
}

export function DocModal({ tenantId, docId, onClose }: { tenantId: ID; docId: ID; onClose: () => void }) {
  const { api, openDrill } = useApp();
  let data: ReturnType<typeof api.document>;
  try {
    data = api.document(tenantId, docId);
  } catch (e) {
    return <Modal title="Құжат" onClose={onClose}><div className="callout danger">{(e as Error).message}</div></Modal>;
  }
  const { doc, txs } = data;
  const conn = api.db.connections.find((c) => c.tenantId === tenantId);
  const cp = api.db.counterparties.find((c) => c.id === doc.counterpartyId);
  return (
    <Modal title={`${DOC_TYPE_LABEL[doc.type]} №${doc.number}`} onClose={onClose}>
      <div className="row">
        <Badge tone={doc.posted ? 'ok' : 'warn'}>{doc.posted ? 'Өткізілген' : 'Өткізілмеген'}</Badge>
        <Badge tone={doc.hasPrimaryFile ? 'ok' : 'warn'}>{doc.hasPrimaryFile ? 'Бастапқы құжат файлы бар' : 'Файл жоқ'}</Badge>
        <DemoBadge label={doc.source === 'mock_1c' ? '1С · MockConnector' : doc.source === 'csv' ? 'CSV импорт' : 'Платформаға жүктелген'} />
      </div>
      <table className="tbl">
        <tbody>
          <tr><td className="muted">Күні</td><td>{fmtDate(doc.date)}</td></tr>
          <tr><td className="muted">Сома</td><td><Kzt v={doc.amount} /></td></tr>
          <tr><td className="muted">Филиал</td><td>{api.db.branches.find((b) => b.id === doc.branchId)?.name ?? 'Компания'}</td></tr>
          <tr><td className="muted">Контрагент</td><td>{cp?.name ?? '—'}</td></tr>
          <tr><td className="muted">Сыртқы ID (1С)</td><td className="small">{doc.externalId}</td></tr>
          <tr>
            <td className="muted">1С-тегі автор</td>
            <td>
              {doc.sourceAuthor ?? (
                <span className="muted small">
                  {conn?.hasSourceAuditInfo ? 'Бұл құжат үшін аудит дерегі жоқ' : '1С аудит дерегі қолжетімсіз'} — автор белгісіз. Платформадағы тапсырма орындаушысы 1С авторы деп есептелмейді.
                </span>
              )}
            </td>
          </tr>
          {doc.note && <tr><td className="muted">Ескертпе</td><td>{doc.note}</td></tr>}
        </tbody>
      </table>
      <div className="callout small">Файлды қарау: <span className="muted">demo-да скан/PDF сақталмайды — тек метадерек.</span></div>
      {txs.length > 0 && (
        <>
          <h3>Байланысты операциялар</h3>
          <button className="btn sm" onClick={() => openDrill({ title: `№${doc.number} операциялары`, tenantId, txIds: txs.map((t) => t.id) })}>Операциялар тізімі ({txs.length})</button>
        </>
      )}
    </Modal>
  );
}

function StatusSteps({ s }: { s: FindingStatus }) {
  if (s === 'not_an_error') return <div className="steps"><span className="step cur">Қате емес</span></div>;
  const idx = FINDING_FLOW.indexOf(s);
  return (
    <div className="steps">
      {FINDING_FLOW.map((x, i) => (
        <span key={x} className={`step ${i < idx ? 'done' : i === idx ? 'cur' : ''}`}>{FINDING_STATUS_LABEL[x]}</span>
      ))}
    </div>
  );
}

export function AssignForm({ tenantId, onSubmit, onCancel, defaultTitle }: { tenantId: ID; onSubmit: (p: { assigneeId: ID; reviewerId: ID | null; plannedDue: string; complexity: Complexity; note: string }) => void; onCancel: () => void; defaultTitle?: string }) {
  const { api } = useApp();
  const accs = api.staff(tenantId).filter((s) => s.roles.includes('accountant') || s.roles.includes('chief_accountant'));
  const chiefs = api.staff(tenantId, 'chief_accountant');
  const ag = api.db.agreements.find((a) => a.tenantId === tenantId);
  const [assigneeId, setA] = useState<ID>('');
  const [reviewerId, setR] = useState<ID>(ag?.reviewerId ?? chiefs[0]?.user.id ?? '');
  const [plannedDue, setD] = useState(addDays(api.today(), 3));
  const [complexity, setC] = useState<Complexity>('standard');
  const [note, setN] = useState('');
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <h3 className="mb8">Бухгалтерге тапсыру{defaultTitle ? `: ${defaultTitle}` : ''}</h3>
      <div className="callout small mb8">Жауапты мен мерзімді сіз бекітесіз — жүйе оларды автоматты түрде қоймайды.</div>
      <div className="grid g2">
        <label className="field">
          Орындаушы *
          <select value={assigneeId} onChange={(e) => setA(e.target.value)}>
            <option value="">— таңдаңыз —</option>
            {accs.map((s) => (
              <option key={s.user.id} value={s.user.id}>{s.user.name}{s.user.id === ag?.responsibleAccountantId ? ' (жауапты бухгалтер)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Тексеруші
          <select value={reviewerId} onChange={(e) => setR(e.target.value)}>
            {chiefs.map((s) => <option key={s.user.id} value={s.user.id}>{s.user.name}</option>)}
          </select>
        </label>
        <label className="field">
          Мерзімі *
          <input type="date" value={plannedDue} min={api.today()} onChange={(e) => setD(e.target.value)} />
        </label>
        <label className="field">
          Күрделілігі
          <select value={complexity} onChange={(e) => setC(e.target.value as Complexity)}>
            {(['simple', 'standard', 'complex'] as Complexity[]).map((c) => <option key={c} value={c}>{COMPLEXITY_LABEL[c]} (коэф. {api.weight(c)})</option>)}
          </select>
        </label>
      </div>
      <label className="field mt8">
        Ескертпе
        <textarea value={note} onChange={(e) => setN(e.target.value)} placeholder="Мысалы: жеткізушімен сөйлесіп растаңыз" />
      </label>
      <div className="row mt8">
        <button className="btn primary" disabled={!assigneeId || !plannedDue} onClick={() => onSubmit({ assigneeId, reviewerId, plannedDue, complexity, note })}>Тапсырма жасау</button>
        <button className="btn" onClick={onCancel}>Болдырмау</button>
      </div>
    </div>
  );
}

export function FindingModal({ id, onClose }: { id: ID; onClose: () => void }) {
  const { api, run, openDoc, openTask, openDrill } = useApp();
  const [assign, setAssign] = useState(false);
  const [mode, setMode] = useState<null | 'not_an_error' | 'fix_proposed' | 'closed'>(null);
  const [text, setText] = useState('');
  const [impact, setImpact] = useState('0');
  let f: ReturnType<typeof api.finding>;
  try {
    f = api.finding(id);
  } catch (e) {
    return <Modal title="Мәселе" onClose={onClose}><div className="callout danger">{(e as Error).message}</div></Modal>;
  }
  const rule = RULES.find((r) => r.id === f.ruleId)!;
  const actions = api.findingActions(f);
  const task = f.taskId ? api.db.tasks.find((t) => t.id === f.taskId) : null;
  const canAssign = api.can('tasks.create_from_issue', f.tenantId) && (!task || ['done', 'cancelled'].includes(task.status)) && !['closed', 'not_an_error'].includes(f.status);
  const tenant = api.db.tenants.find((t) => t.id === f.tenantId)!;
  const branch = api.db.branches.find((b) => b.id === f.branchId);
  const txSum = f.txIds.length ? sum(f.txIds.map((x) => api.db.transactions.find((t) => t.id === x)?.amount ?? 0)) : null;

  const doTransition = (to: FindingStatus) => {
    if (to === 'not_an_error' || to === 'fix_proposed' || to === 'closed') {
      setMode(to);
      setText(to === 'fix_proposed' ? f.fixEvidence ?? '' : '');
      return;
    }
    run(() => api.transitionFinding(f.id, to), `Мәртебе: ${FINDING_STATUS_LABEL[to]}`);
  };

  return (
    <Modal title={f.title} onClose={onClose} wide>
      <div className="row">
        <KindBadge kind={f.kind} />
        <SeverityBadge s={f.severity} />
        <FindingStatusBadge s={f.status} />
        {f.kind === 'ai' && <span className="small muted">AI күмәні автоматты түрде «дәлелденген қате» болып саналмайды.</span>}
      </div>
      <StatusSteps s={f.status} />
      <dl className="issue chain" style={{ border: 0, padding: 0 }}>
        <dt>Не болды</dt><dd>{f.whatHappened}</dd>
        <dt>Бизнеске әсері</dt><dd>{f.businessImpact}</dd>
        <dt>Қандай әрекет керек</dt><dd>{f.actionNeeded}</dd>
        <dt>Жауапты</dt><dd>{api.userName(f.assigneeId)}</dd>
        <dt>Мерзімі</dt><dd>{fmtDate(f.dueDate)}</dd>
      </dl>
      <div className="grid g2">
        <table className="tbl small">
          <tbody>
            <tr><td className="muted">Компания</td><td>{tenant.name}</td></tr>
            <tr><td className="muted">Филиал</td><td>{branch?.name ?? 'Компания деңгейі'}</td></tr>
            <tr><td className="muted">Операция</td><td>{f.txIds.length ? <a onClick={() => openDrill({ title: 'Мәселеге байланысты операциялар', tenantId: f.tenantId, txIds: f.txIds })}>{f.txIds.length} операция ({fmtKzt(txSum)})</a> : '—'}</td></tr>
            <tr><td className="muted">Анықталған уақыт</td><td>{fmtDateTime(f.detectedAt)}</td></tr>
            <tr><td className="muted">Тексеру ережесі</td><td>{rule.code} · {rule.name}{rule.blocksPeriodClose && <> <Badge tone="warn">ай жабуды бөгейді</Badge></>}</td></tr>
          </tbody>
        </table>
        <table className="tbl small">
          <tbody>
            <tr><td className="muted">Ықтимал әсер</td><td>{f.potentialImpact === null ? <span className="muted">бағаланбаған</span> : <><Kzt v={f.potentialImpact} /> <span className="muted tiny">(расталмаған, жоғалту емес)</span></>}</td></tr>
            <tr><td className="muted">Расталған әсер</td><td>{f.confirmedImpact === null ? <span className="muted">әлі расталмаған</span> : <Kzt v={f.confirmedImpact} />}</td></tr>
            <tr><td className="muted">Маңыздылық</td><td><SeverityBadge s={f.severity} /></td></tr>
            <tr><td className="muted">Кезең</td><td>{f.period}</td></tr>
            <tr><td className="muted">Тапсырма</td><td>{task ? <a onClick={() => openTask(task.id)}>{task.title} · {TASK_STATUS_LABEL[task.status]}</a> : <span className="muted">жоқ</span>}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="callout"><b>Дәлел:</b> <span className="pre">{f.evidence}</span></div>
      {f.docIds.length > 0 && (
        <div className="row small">
          <b>Бастапқы құжаттар:</b>
          {f.docIds.map((d) => {
            const doc = api.db.documents.find((x) => x.id === d);
            return <a key={d} onClick={() => openDoc(f.tenantId, d)}>№{doc?.number ?? d}</a>;
          })}
        </div>
      )}
      {f.notAnErrorReason && <div className="callout"><b>«Қате емес» негіздемесі:</b> {f.notAnErrorReason}</div>}
      {f.fixEvidence && <div className="callout info"><b>Түзету дәлелі:</b> {f.fixEvidence}</div>}
      {f.recheck && <div className={`callout ${f.recheck.passed ? 'info' : 'warn'}`}><b>Қайта тексеру ({fmtDateTime(f.recheck.at)}):</b> {f.recheck.passed ? '✓ сәтті' : '✗ сәтсіз'} — {f.recheck.detail}</div>}

      {canAssign && !assign && (
        <div className="row"><button className="btn primary" onClick={() => setAssign(true)}>Бухгалтерге тапсыру</button></div>
      )}
      {assign && (
        <AssignForm
          tenantId={f.tenantId}
          onCancel={() => setAssign(false)}
          onSubmit={(p) => {
            const t = run(() => api.createTaskFromFinding(f.id, p), 'Тапсырма жасалды');
            if (t) setAssign(false);
          }}
        />
      )}

      {(actions.length > 0 || f.status === 'approved' || f.status === 'fix_proposed') && api.can('findings.work', f.tenantId) && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h4 className="mb8">Әрекеттер</h4>
          <div className="row">
            {actions.filter((a) => a !== 'rechecked').map((a) => (
              <button key={a} className={`btn ${a === 'approved' || a === 'closed' ? 'primary' : ''}`} onClick={() => doTransition(a)}>
                → {FINDING_STATUS_LABEL[a]}
              </button>
            ))}
            {(f.status === 'approved' || f.status === 'fix_proposed') && (
              <button className="btn" onClick={() => run(() => api.recheck(f.id), 'Қайта тексеру орындалды')} title="MockConnector арқылы 1С-ті қайта оқып, ережені қайта іске қосады">
                ↻ Қайта тексеру (1С-ті қайта оқу)
              </button>
            )}
          </div>
          {mode && (
            <div className="col mt8">
              <label className="field">
                {mode === 'not_an_error' ? 'Негіздеме (неге қате емес?) *' : mode === 'fix_proposed' ? 'Түзету дәлелі *' : 'Жабу ескертпесі'}
                <textarea value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {mode === 'closed' && (
                <label className="field" style={{ maxWidth: 260 }}>
                  Расталған әсер, ₸ (тексеру нәтижесі)
                  <input value={impact} onChange={(e) => setImpact(e.target.value)} />
                </label>
              )}
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() => {
                    const r = run(
                      () =>
                        api.transitionFinding(f.id, mode, mode === 'not_an_error' ? { reason: text } : mode === 'fix_proposed' ? { fixEvidence: text } : { note: text, confirmedImpact: tenge(impact || '0') }),
                      `Мәртебе: ${FINDING_STATUS_LABEL[mode]}`,
                    );
                    if (r) setMode(null);
                  }}
                >
                  Растау
                </button>
                <button className="btn" onClick={() => setMode(null)}>Болдырмау</button>
              </div>
            </div>
          )}
          {f.status === 'rechecked' && !actions.includes('closed') && <div className="small muted mt8">Жабуды бас бухгалтер жасайды.</div>}
        </div>
      )}

      <h3>Тарих</h3>
      <div className="timeline">
        {f.history.map((h, i) => (
          <div className="ev" key={i}>
            <b>{h.from === h.to ? 'Өзгеріс' : `${h.from ? `${FINDING_STATUS_LABEL[h.from]} → ` : ''}${FINDING_STATUS_LABEL[h.to]}`}</b> · {api.userName(h.by)} <span className="muted">{fmtDateTime(h.at)}</span>
            {h.note && <div className="muted small">{h.note}</div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function TaskModal({ id, onClose }: { id: ID; onClose: () => void }) {
  const { api, run, openDoc, openFinding } = useApp();
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [evKind, setEvKind] = useState<TaskEvidence['kind']>('source_fix');
  const [evText, setEvText] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [decisionNote, setDecisionNote] = useState('');
  const [upload, setUpload] = useState({ number: '', fileName: '', note: '' });
  const [pending, setPending] = useState<TaskStatus | null>(null);
  let t: ReturnType<typeof api.task>;
  try {
    t = api.task(id);
  } catch (e) {
    return <Modal title="Тапсырма" onClose={onClose}><div className="callout danger">{(e as Error).message}</div></Modal>;
  }
  const actions = api.taskActions(t).filter((a) => a !== 'done' && a !== 'returned');
  const canReview = t.status === 'in_review' && api.canReviewTask(t);
  const isAssignee = t.assigneeId === api.userId;
  const roles = api.roles(t.tenantId);
  const isOwner = roles.includes('owner');
  const isClient = isOwner || roles.includes('client_manager');
  const events = api.taskEvents(t.id);
  const tenant = api.db.tenants.find((x) => x.id === t.tenantId)!;
  const late = !['done', 'cancelled'].includes(t.status) && t.plannedDue < api.today();
  const labels: Partial<Record<TaskStatus, string>> = { in_progress: t.status === 'todo' ? '▶ Бастау' : '▶ Жалғастыру', waiting_client: '⏸ Клиент жауабын күту', in_review: '✓ Тексеруге жіберу', cancelled: 'Тоқтату' };
  const minutesLogged = api.db.workLogs.filter((w) => w.taskId === t.id).reduce((s, w) => s + w.minutes, 0);

  return (
    <Modal title={t.title} onClose={onClose} wide>
      <div className="row">
        <TaskStatusBadge s={t.status} />
        {late && <Badge tone="danger">Мерзімі өтті</Badge>}
        {t.needsOwnerDecision && !t.ownerDecision && <Badge tone="warn">Кәсіпкердің шешімін күтеді</Badge>}
        <Badge tone="outline">{COMPLEXITY_LABEL[t.complexity]} · {api.weight(t.complexity)} бірлік</Badge>
        {t.source === 'ai' && <Badge tone="ai">AI жауабынан жасалған</Badge>}
        {t.returnCount > 0 && <Badge tone="warn">Кері қайтарылды: {t.returnCount}</Badge>}
      </div>
      {t.description && <div className="pre small">{t.description}</div>}
      <div className="grid g2">
        <table className="tbl small">
          <tbody>
            <tr><td className="muted">Компания</td><td>{tenant.name}</td></tr>
            <tr><td className="muted">Операция түрі</td><td>{t.opType}</td></tr>
            <tr><td className="muted">Орындаушы</td><td>{api.userName(t.assigneeId)}{t.clientAssigneeId ? ` · клиент тарапынан: ${api.userName(t.clientAssigneeId)}` : ''}</td></tr>
            <tr><td className="muted">Тексеруші</td><td>{api.userName(t.reviewerId)}</td></tr>
            <tr><td className="muted">Күрделілік</td><td>{COMPLEXITY_LABEL[t.complexity]}</td></tr>
            <tr><td className="muted">Байланысты мәселе</td><td>{t.findingId ? <a onClick={() => openFinding(t.findingId!)}>ашу →</a> : '—'}</td></tr>
          </tbody>
        </table>
        <table className="tbl small">
          <tbody>
            <tr><td className="muted">Жоспарлы мерзім</td><td>{fmtDate(t.plannedDue)}</td></tr>
            <tr><td className="muted">Басталды</td><td>{fmtDateTime(t.startedAt)}</td></tr>
            <tr><td className="muted">Аяқталды</td><td>{fmtDateTime(t.finishedAt)}</td></tr>
            <tr><td className="muted">Күту себебі</td><td>{t.waitReason ?? '—'}</td></tr>
            <tr><td className="muted">Нақты уақыт</td><td>{Math.round(minutesLogged / 6) / 10} сағ</td></tr>
            <tr><td className="muted">Байланысты құжаттар</td><td>{t.docIds.length ? t.docIds.map((d) => <a key={d} style={{ marginRight: 8 }} onClick={() => openDoc(t.tenantId, d)}>№{api.db.documents.find((x) => x.id === d)?.number ?? d}</a>) : '—'}</td></tr>
          </tbody>
        </table>
      </div>

      {t.needsOwnerDecision && t.ownerDecision && <div className="callout info"><b>Кәсіп иесінің шешімі:</b> {t.ownerDecision.decision === 'approved' ? 'Бекітілді' : 'Қабылданбады'} — {t.ownerDecision.note} ({api.userName(t.ownerDecision.by)}, {fmtDateTime(t.ownerDecision.at)})</div>}
      {t.needsOwnerDecision && !t.ownerDecision && isOwner && (
        <div className="card" style={{ background: 'var(--warn-soft)' }}>
          <h3 className="mb8">Сіздің шешіміңіз</h3>
          <textarea placeholder="Мысалы: Бұл тауар жеткізу авансы, шарт №12 / Бұл менің жеке шығыным" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
          <div className="row mt8">
            <button className="btn primary" onClick={() => run(() => api.ownerDecision(t.id, 'approved', decisionNote), 'Шешім жіберілді')}>Бекіту / жауап беру</button>
            <button className="btn" onClick={() => run(() => api.ownerDecision(t.id, 'rejected', decisionNote), 'Шешім жіберілді')}>Қабылдамау</button>
          </div>
        </div>
      )}

      {(actions.length > 0 || canReview) && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h4 className="mb8">Әрекеттер</h4>
          <div className="row">
            {actions.map((a) => (
              <button key={a} className={`btn ${a === 'in_review' ? 'primary' : ''}`} onClick={() => (a === 'waiting_client' ? setPending(a) : run(() => api.transitionTask(t.id, a), TASK_STATUS_LABEL[a]))}>
                {labels[a] ?? TASK_STATUS_LABEL[a]}
              </button>
            ))}
          </div>
          {pending === 'waiting_client' && (
            <div className="row mt8">
              <input className="grow" placeholder="Күту себебі (мысалы: клиенттен акт күтілуде)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn primary" onClick={() => run(() => api.transitionTask(t.id, 'waiting_client', note), 'Клиент жауабын күтуде') && setPending(null)}>Растау</button>
            </div>
          )}
          {canReview && (
            <div className="col mt8">
              <b>Тексеру қорытындысы</b>
              <textarea placeholder="Ескертпе (кері қайтарғанда міндетті)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row">
                <button className="btn primary" onClick={() => run(() => api.reviewTask(t.id, 'accepted', note), 'Жұмыс қабылданды')}>✓ Қабылдау</button>
                <button className="btn danger" onClick={() => run(() => api.reviewTask(t.id, 'returned', note), 'Кері қайтарылды')}>↩ Кері қайтару</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid g2">
        <div className="col">
          <h3>Нәтиже дәлелі ({t.evidence.length})</h3>
          {t.evidence.map((e) => (
            <div key={e.id} className="callout small">
              <Badge tone={e.kind === 'source_fix' ? 'info' : 'outline'}>{e.kind === 'source_fix' ? '1С-те түзетілді' : e.kind === 'document' ? 'Құжат' : e.kind === 'reconciliation' ? 'Салыстыру' : 'Түсініктеме'}</Badge> {e.text}
              <div className="muted tiny">{api.userName(e.by)} · {fmtDateTime(e.at)}</div>
            </div>
          ))}
          {(isAssignee || roles.includes('chief_accountant')) && !['done', 'cancelled'].includes(t.status) && (
            <div className="col">
              <div className="row">
                <select value={evKind} onChange={(e) => setEvKind(e.target.value as TaskEvidence['kind'])}>
                  <option value="source_fix">1С-те түзетілді</option>
                  <option value="document">Құжат</option>
                  <option value="reconciliation">Салыстыру</option>
                  <option value="explanation">Түсініктеме</option>
                </select>
                <input className="grow" value={evText} onChange={(e) => setEvText(e.target.value)} placeholder="Не жасалды? (мысалы: ПН-2001 дұрыс күнмен өткізілді)" />
                <button className="btn" onClick={() => run(() => api.addEvidence(t.id, evKind, evText), 'Дәлел қосылды') !== undefined && setEvText('')}>Қосу</button>
              </div>
              {isAssignee && (
                <div className="row small">
                  Уақыт жазу:
                  <input style={{ width: 80 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} /> мин
                  <button className="btn sm" onClick={() => run(() => api.logWork(t.id, parseInt(minutes, 10)), 'Уақыт жазылды')}>Жазу</button>
                </div>
              )}
            </div>
          )}
          {t.reviewResult && <div className={`callout ${t.reviewResult.decision === 'accepted' ? 'info' : 'warn'}`}><b>Тексеру қорытындысы:</b> {t.reviewResult.decision === 'accepted' ? 'Қабылданды' : 'Кері қайтарылды'}{t.reviewResult.note ? ` — ${t.reviewResult.note}` : ''} <span className="muted tiny">({api.userName(t.reviewResult.by)}, {fmtDateTime(t.reviewResult.at)})</span></div>}
        </div>
        <div className="col">
          <h3>Пікірлер ({t.comments.length})</h3>
          {t.comments.map((c) => (
            <div key={c.id} className="small">
              <b>{api.userName(c.by)}</b> <span className="muted tiny">{fmtDateTime(c.at)}</span>
              <div>{c.text}</div>
            </div>
          ))}
          <div className="row">
            <input className="grow" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Пікір жазу…" />
            <button className="btn" onClick={() => run(() => api.addComment(t.id, comment)) !== undefined && setComment('')}>Жіберу</button>
          </div>
          {isClient && api.can('docs.upload', t.tenantId) && !['done', 'cancelled'].includes(t.status) && (
            <div className="callout small col">
              <b>Құжат жүктеу (клиент)</b>
              <div className="row">
                <input placeholder="Құжат №" value={upload.number} onChange={(e) => setUpload({ ...upload, number: e.target.value })} style={{ width: 110 }} />
                <input placeholder="Файл атауы, мысалы akt.pdf" value={upload.fileName} onChange={(e) => setUpload({ ...upload, fileName: e.target.value })} className="grow" />
              </div>
              <button className="btn sm" disabled={!upload.number || !upload.fileName} onClick={() => run(() => api.uploadDocument(t.tenantId, { type: 'service_act', number: upload.number, date: api.today(), amount: 0, note: 'Клиент жүктеді', fileName: upload.fileName, branchId: null, taskId: t.id }), 'Құжат жүктелді') && setUpload({ number: '', fileName: '', note: '' })}>
                Жүктеу <DemoBadge label="файл сақталмайды" />
              </button>
            </div>
          )}
        </div>
      </div>

      <h3>Оқиғалар журналы</h3>
      <div className="timeline">
        {events.map((e) => (
          <div className="ev" key={e.id}>
            <b>{e.type === 'status' || e.type === 'review' ? `${e.from ? TASK_STATUS_LABEL[e.from as TaskStatus] ?? e.from : ''} → ${TASK_STATUS_LABEL[e.to as TaskStatus] ?? e.to}` : e.type === 'created' ? 'Жасалды' : e.type === 'assigned' ? `Тағайындалды: ${api.userName(e.from)} → ${api.userName(e.to)}` : e.type === 'decision' ? `Шешім: ${e.to}` : e.type === 'evidence' ? 'Дәлел қосылды' : 'Пікір'}</b> · {api.userName(e.by)} <span className="muted">{fmtDateTime(e.at)}</span>
            {e.note && <div className="muted small">{e.note}</div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
