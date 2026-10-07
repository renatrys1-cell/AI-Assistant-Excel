/**
 * Қолданбалы API («backend» қабаты). UI деректі тек осы класс арқылы алады.
 * Әр әдіс: (1) tenant қолжетімділігін, (2) рөл рұқсатын тексереді, (3) өзгерісті аудит журналына жазады.
 * DEMO: браузерде орындалады, деректер localStorage-та. Бұл production қауіпсіздігі ЕМЕС.
 */
import type {
  Db, ID, Role, Finding, FindingStatus, Task, TaskStatus, Complexity, TaskEvidence, SourceDocument, Tenant, ServiceAgreement, TariffCode, ConnectionMethod, DocType,
} from '../domain/types';
import { ForbiddenError, can, canAnywhere, accessibleTenantIds, rolesIn, allRoles, activeMemberships, type Perm } from './authz';
import { DEMO_NOW, findPeriod, previousPeriod, addDays, almatyDate, monthsBetween, monthEnd, monthStart, diffDays, type Period } from '../domain/periods';
import { pnl, cashFlow, dailyCash, debts, paymentCalendar, branchComparison, ownerOps, planVsFact, profitToCashBridge, inventoryAt, dataFreshness, type Scope } from '../domain/finance';
import { runChecks, recheckFinding, RULES, OPEN_FINDING_STATUSES, impactSummary } from '../domain/checks';
import { transitionFinding, transitionTask, findingStatusForTask, allowedFindingTransitions, allowedTaskTransitions, canReview, WorkflowError } from '../domain/workflow';
import { accountantKpi, duplicateTasks, findOpenDuplicate, weightOf } from '../domain/kpi';
import { importCsv } from '../domain/csv';
import { CONNECTORS, applySimulatedSourceFix } from './connector';
import { askAi, type AiAnswer } from './ai';
import { DEFAULT_CHECKLIST } from '../domain/seed';
import { mulDiv, sum, type Money } from '../domain/money';

export { ForbiddenError, WorkflowError };

export class Api {
  constructor(
    public db: Db,
    public userId: ID,
    private onCommit: () => void = () => {},
  ) {}

  // ───────── Уақыт ─────────
  now(): string {
    const ms = new Date(DEMO_NOW).getTime() + Math.max(0, Date.now() - this.db.clockBaseMs);
    return new Date(ms).toISOString();
  }
  today(): string {
    return almatyDate(this.now());
  }
  private nextId(p: string) {
    return `${p}_${(this.db.seq++).toString(36)}`;
  }

  // ───────── Аудит ─────────
  private audit(action: string, entity: string, entityId: ID | null, tenantId: ID | null, details = '', result: 'ok' | 'denied' | 'error' = 'ok') {
    const role = tenantId ? rolesIn(this.db, this.userId, tenantId, this.now())[0] ?? null : allRoles(this.db, this.userId, this.now())[0] ?? null;
    this.db.audit.push({ id: this.nextId('au'), at: this.now(), userId: this.userId, role, tenantId, action, entity, entityId, result, details });
  }
  private commit() {
    this.onCommit();
  }

  // ───────── Рұқсат ─────────
  private require(perm: Perm, tenantId: ID | null, what = '') {
    if (!can(this.db, this.userId, perm, tenantId, this.now())) {
      this.audit('access_denied', what || perm, null, tenantId, `Рұқсат жоқ: ${perm}`, 'denied');
      this.commit();
      throw new ForbiddenError(tenantId && !accessibleTenantIds(this.db, this.userId, this.now()).includes(tenantId) ? 'Бұл компанияның деректеріне қолжетімділік жоқ' : `Рұқсат жоқ (${perm})`);
    }
  }
  roles(tenantId: ID | null): Role[] {
    return rolesIn(this.db, this.userId, tenantId, this.now());
  }
  allRoles(): Role[] {
    return allRoles(this.db, this.userId, this.now());
  }
  can(perm: Perm, tenantId: ID | null): boolean {
    return can(this.db, this.userId, perm, tenantId, this.now());
  }
  canAnywhere(perm: Perm): boolean {
    return canAnywhere(this.db, this.userId, perm, this.now());
  }
  me() {
    return this.db.users.find((u) => u.id === this.userId)!;
  }
  userName(id: ID | null | undefined): string {
    if (!id) return '—';
    if (id === 'system') return 'Жүйе';
    return this.db.users.find((u) => u.id === id)?.name ?? id;
  }

  // ───────── Компаниялар ─────────
  tenants(): Tenant[] {
    const ids = accessibleTenantIds(this.db, this.userId, this.now());
    return this.db.tenants.filter((t) => ids.includes(t.id));
  }
  tenant(tenantId: ID): Tenant {
    if (!accessibleTenantIds(this.db, this.userId, this.now()).includes(tenantId)) {
      this.audit('access_denied', 'Tenant', tenantId, tenantId, 'Басқа компанияның деректерін ашу әрекеті', 'denied');
      this.commit();
      throw new ForbiddenError('Бұл компанияның деректеріне қолжетімділік жоқ');
    }
    return this.db.tenants.find((t) => t.id === tenantId)!;
  }
  branches(tenantId: ID) {
    this.tenant(tenantId);
    return this.db.branches.filter((b) => b.tenantId === tenantId);
  }
  /** Tenant-қа бекітілген қызмет қызметкерлері (тапсырма беру үшін) */
  staff(tenantId: ID, role?: Role) {
    this.tenant(tenantId);
    const ms = this.db.memberships.filter((m) => m.tenantId === tenantId && !m.revokedAt && (!role || m.role === role));
    return [...new Set(ms.map((m) => m.userId))].map((id) => ({ user: this.db.users.find((u) => u.id === id)!, roles: ms.filter((m) => m.userId === id).map((m) => m.role) }));
  }

  // ───────── Қаржы ─────────
  finance(tenantId: ID, branchId: ID | null, periodKey: string) {
    this.tenant(tenantId);
    this.require('finance.read', tenantId, 'Finance');
    if (branchId && !this.db.branches.some((b) => b.id === branchId && b.tenantId === tenantId)) throw new ForbiddenError('Филиал бұл компанияға жатпайды');
    const period = findPeriod(periodKey);
    const fresh = dataFreshness(this.db, tenantId, this.now());
    // Деректер ескі болса — кезең соңы соңғы сәтті синхрондау күнімен шектеледі
    const dataTo = fresh.lastSuccessAt ? (almatyDate(fresh.lastSuccessAt) < period.to ? addDays(almatyDate(fresh.lastSuccessAt), 0) : period.to) : period.to;
    const lastDataDay = this.db.transactions.filter((t) => t.tenantId === tenantId).reduce((m, t) => (t.date > m ? t.date : m), '');
    const effectiveTo = lastDataDay && lastDataDay < period.to ? lastDataDay : period.to;
    const s: Scope = { tenantId, branchId, from: period.from, to: period.to };
    const prev = previousPeriod(period);
    const months = monthsBetween(period.from, period.to);
    const closes = months.map((m) => this.db.periodCloses.find((p) => p.tenantId === tenantId && p.period === m)).filter(Boolean);
    const hasData = this.db.transactions.some((t) => t.tenantId === tenantId);
    return {
      period,
      prevPeriod: prev,
      scope: s,
      hasData,
      effectiveTo,
      dataTo,
      pnl: pnl(this.db, s),
      prevPnl: pnl(this.db, { ...s, from: prev.from, to: prev.to }),
      cash: cashFlow(this.db, s),
      daily: dailyCash(this.db, s),
      ar: debts(this.db, tenantId, 'customer', effectiveTo, branchId),
      ap: debts(this.db, tenantId, 'supplier', effectiveTo, branchId),
      calendar: paymentCalendar(this.db, tenantId, lastDataDay || period.to, 30),
      branches: branchComparison(this.db, tenantId, period.from, period.to),
      owner: ownerOps(this.db, s),
      plan: planVsFact(this.db, s),
      bridge: profitToCashBridge(this.db, { ...s, branchId: null }),
      inventory: inventoryAt(this.db, tenantId, branchId, effectiveTo),
      freshness: fresh,
      closes: closes as NonNullable<(typeof closes)[number]>[],
      reportStatus: closes.every((c) => c!.status === 'closed') && closes.length === months.length ? ('final' as const) : ('preliminary' as const),
      stockLines: this.db.stock.filter((x) => x.tenantId === tenantId && (!branchId || x.branchId === branchId)),
    };
  }

  transactions(tenantId: ID, ids: ID[]) {
    this.tenant(tenantId);
    this.require('finance.read', tenantId, 'Transaction');
    const set = new Set(ids);
    return this.db.transactions.filter((t) => t.tenantId === tenantId && set.has(t.id));
  }

  // ───────── Құжаттар ─────────
  documents(tenantId: ID) {
    this.tenant(tenantId);
    this.require('docs.read', tenantId, 'SourceDocument');
    return this.db.documents.filter((d) => d.tenantId === tenantId);
  }
  document(tenantId: ID, docId: ID) {
    this.tenant(tenantId);
    this.require('docs.read', tenantId, 'SourceDocument');
    const d = this.db.documents.find((x) => x.id === docId && x.tenantId === tenantId);
    if (!d) throw new ForbiddenError('Құжат табылмады немесе қолжетімсіз');
    const txs = this.can('finance.read', tenantId) ? this.db.transactions.filter((t) => t.docId === d.id) : [];
    return { doc: d, txs };
  }
  uploadDocument(tenantId: ID, p: { type: DocType; number: string; date: string; amount: Money; note: string; fileName: string; branchId: ID | null; taskId?: ID }) {
    this.tenant(tenantId);
    this.require('docs.upload', tenantId, 'SourceDocument');
    const d: SourceDocument = {
      id: this.nextId('doc'), tenantId, branchId: p.branchId, externalId: `upload:${tenantId}:${this.db.seq}`, type: p.type, number: p.number, date: p.date, counterpartyId: null,
      amount: p.amount, posted: false, hasPrimaryFile: true, sourceAuthor: null, source: 'upload', note: `${p.note} · файл: ${p.fileName} (demo: файлдың өзі сақталмайды)`, uploadedBy: this.userId,
    };
    this.db.documents.push(d);
    if (p.taskId) {
      const t = this.taskOrThrow(p.taskId);
      t.docIds.push(d.id);
      t.comments.push({ id: this.nextId('c'), at: this.now(), by: this.userId, text: `Құжат жүктелді: №${d.number} (${p.fileName})` });
    }
    this.audit('document_upload', 'SourceDocument', d.id, tenantId, `№${d.number}`);
    this.commit();
    return d;
  }

  // ───────── Мәселелер ─────────
  findings(tenantId: ID | null): Finding[] {
    const ids = tenantId ? [this.tenant(tenantId).id] : accessibleTenantIds(this.db, this.userId, this.now());
    const allowed = ids.filter((t) => this.can('findings.read', t));
    if (tenantId && !allowed.length) this.require('findings.read', tenantId, 'Finding');
    return this.db.findings.filter((f) => allowed.includes(f.tenantId));
  }
  finding(id: ID): Finding {
    const f = this.db.findings.find((x) => x.id === id);
    if (!f) throw new ForbiddenError('Мәселе табылмады');
    this.tenant(f.tenantId);
    this.require('findings.read', f.tenantId, 'Finding');
    return f;
  }
  findingActions(f: Finding): FindingStatus[] {
    return allowedFindingTransitions(f, this.roles(f.tenantId));
  }
  impact(tenantId: ID) {
    return impactSummary(this.findings(tenantId), this.db);
  }
  private replaceFinding(f: Finding) {
    const i = this.db.findings.findIndex((x) => x.id === f.id);
    this.db.findings[i] = f;
  }
  transitionFinding(id: ID, to: FindingStatus, p: { note?: string; reason?: string; fixEvidence?: string; confirmedImpact?: Money | null } = {}) {
    const f = this.finding(id);
    this.require('findings.work', f.tenantId, 'Finding');
    const next = transitionFinding(f, { to, by: this.userId, roles: this.roles(f.tenantId), at: this.now(), ...p });
    this.replaceFinding(next);
    this.audit('finding_status', 'Finding', id, f.tenantId, `${f.status} → ${to}${p.reason ? ` · ${p.reason}` : ''}`);
    this.commit();
    return next;
  }
  /** Mock 1С-ті қайта оқып, ережені қайта іске қосу */
  recheck(id: ID) {
    const f = this.finding(id);
    this.require('findings.work', f.tenantId, 'Finding');
    if (!['approved', 'fix_proposed', 'rechecked'].includes(f.status)) throw new WorkflowError('Қайта тексеру түзету ұсынылған/бекітілген мәселе үшін ғана');
    const conn = this.db.connections.find((c) => c.tenantId === f.tenantId);
    let detail = '';
    if (f.sourceFixPending) {
      const task = f.taskId ? this.db.tasks.find((t) => t.id === f.taskId) : null;
      detail = applySimulatedSourceFix(this.db, f, () => this.nextId('fx'), task?.ownerDecision?.note);
    }
    const run = { id: this.nextId('sync'), tenantId: f.tenantId, connectionId: conn?.id ?? '-', kind: 'recheck' as const, startedAt: this.now(), finishedAt: this.now(), status: 'success' as const, attempt: 1, received: 1, created: 0, updated: f.sourceFixPending ? 1 : 0, duplicatesSkipped: 0, note: `Mock қайта оқу: ${detail || 'өзгеріс жоқ'}` };
    this.db.syncRuns.push(run);
    const analytic = ['R09', 'R12', 'R13'].includes(f.ruleId);
    let res: { passed: boolean; detail: string };
    if (analytic) {
      const task = f.taskId ? this.db.tasks.find((t) => t.id === f.taskId) : null;
      res = task?.status === 'done' ? { passed: true, detail: 'Бизнес-сигнал: келісілген әрекет орындалды және тексерілді. Көрсеткіш келесі кезеңде бақыланады.' } : { passed: false, detail: 'Бизнес-сигнал: байланысты әрекет әлі қабылданбаған.' };
    } else {
      res = recheckFinding(this.db, f, this.lastDataDay(f.tenantId), this.now());
    }
    const cur = this.db.findings.find((x) => x.id === id)!;
    cur.recheck = { at: this.now(), passed: res.passed, detail: `${detail ? detail + ' ' : ''}${res.detail}`, syncRunId: run.id };
    if (res.passed) cur.sourceFixPending = false;
    if (res.passed && cur.status === 'approved') {
      const next = transitionFinding(cur, { to: 'rechecked', by: this.userId, roles: this.roles(f.tenantId), at: this.now(), note: res.detail });
      this.replaceFinding(next);
    }
    this.audit('finding_recheck', 'Finding', id, f.tenantId, `${res.passed ? 'сәтті' : 'сәтсіз'}: ${res.detail}`);
    // Түзету басқа байланысты мәселелерге де әсер етуі мүмкін (мысалы банк сәйкессіздігі)
    this.commit();
    return cur;
  }
  runChecks(tenantId: ID) {
    this.tenant(tenantId);
    this.require('findings.work', tenantId, 'CheckRule');
    const created = runChecks(this.db, tenantId, this.lastDataDay(tenantId), this.now(), () => this.nextId('f'));
    const defaults: Record<string, ID | undefined> = Object.fromEntries(this.db.agreements.map((a) => [a.tenantId, a.responsibleAccountantId ?? undefined]));
    for (const f of created) {
      f.assigneeId = defaults[tenantId] ?? null;
      f.dueDate = addDays(this.today(), 3);
    }
    this.audit('run_checks', 'CheckRule', null, tenantId, `Жаңа мәселе: ${created.length}`);
    this.commit();
    return created;
  }
  lastDataDay(tenantId: ID): string {
    const d = this.db.transactions.filter((t) => t.tenantId === tenantId).reduce((m, t) => (t.date > m ? t.date : m), '');
    return d || this.today();
  }
  rules() {
    return RULES;
  }

  // ───────── Тапсырмалар ─────────
  tasks(tenantId: ID | null = null): Task[] {
    const ids = tenantId ? [this.tenant(tenantId).id] : accessibleTenantIds(this.db, this.userId, this.now());
    const out: Task[] = [];
    for (const tid of ids) {
      const roles = this.roles(tid);
      if (!this.can('tasks.read', tid)) continue;
      const list = this.db.tasks.filter((t) => t.tenantId === tid);
      if (roles.includes('chief_accountant') || roles.includes('service_lead') || roles.includes('owner')) out.push(...list);
      else if (roles.includes('accountant')) out.push(...list.filter((t) => t.assigneeId === this.userId || t.reviewerId === this.userId));
      else if (roles.includes('client_manager')) out.push(...list.filter((t) => t.clientAssigneeId === this.userId));
    }
    return out;
  }
  task(id: ID): Task {
    const t = this.taskOrThrow(id);
    if (!this.tasks(t.tenantId).some((x) => x.id === id)) {
      this.audit('access_denied', 'Task', id, t.tenantId, 'Тапсырма қолжетімсіз', 'denied');
      this.commit();
      throw new ForbiddenError('Бұл тапсырмаға қолжетімділік жоқ');
    }
    return t;
  }
  private taskOrThrow(id: ID): Task {
    const t = this.db.tasks.find((x) => x.id === id);
    if (!t) throw new ForbiddenError('Тапсырма табылмады');
    this.tenant(t.tenantId);
    return t;
  }
  taskActions(t: Task): TaskStatus[] {
    return allowedTaskTransitions(t, this.userId, this.roles(t.tenantId));
  }
  canReviewTask(t: Task) {
    return this.can('tasks.review', t.tenantId) && canReview(t, this.userId, this.roles(t.tenantId));
  }
  taskEvents(id: ID) {
    this.task(id);
    return this.db.taskEvents.filter((e) => e.taskId === id).sort((a, b) => a.at.localeCompare(b.at));
  }
  private event(t: Task, type: import('../domain/types').TaskEvent['type'], from: string | null, to: string | null, note?: string) {
    this.db.taskEvents.push({ id: this.nextId('te'), tenantId: t.tenantId, taskId: t.id, at: this.now(), by: this.userId, type, from, to, note });
  }
  createTask(tenantId: ID, p: { title: string; description: string; opType: string; assigneeId: ID; reviewerId: ID | null; plannedDue: string; complexity: Complexity; findingId?: ID | null; docIds?: ID[]; source: Task['source'] }) {
    this.tenant(tenantId);
    this.require('tasks.create_from_issue', tenantId, 'Task');
    if (!p.title || p.title.trim().length < 3) throw new WorkflowError('Тапсырма атауын жазыңыз');
    if (!p.assigneeId) throw new WorkflowError('Орындаушыны таңдаңыз');
    if (!p.plannedDue) throw new WorkflowError('Мерзімді көрсетіңіз');
    if (p.plannedDue < this.today()) throw new WorkflowError('Мерзім өткен күн бола алмайды');
    const assigneeOk = this.db.memberships.some((m) => m.userId === p.assigneeId && m.tenantId === tenantId && !m.revokedAt && ['accountant', 'chief_accountant'].includes(m.role));
    if (!assigneeOk) throw new WorkflowError('Орындаушы осы компанияға бекітілген бухгалтер болуы керек');
    const dup = findOpenDuplicate(this.db, { tenantId, findingId: p.findingId ?? null, opType: p.opType, docIds: p.docIds ?? [] });
    if (dup) throw new WorkflowError(`Қайталанған тапсырма: «${dup.title}» ашық (орындаушы: ${this.userName(dup.assigneeId)}). Жаңасын жасамай, барын пайдаланыңыз.`);
    const t: Task = {
      id: this.nextId('task'), tenantId, title: p.title, opType: p.opType, description: p.description, findingId: p.findingId ?? null, docIds: p.docIds ?? [], assigneeId: p.assigneeId,
      reviewerId: p.reviewerId, complexity: p.complexity, plannedDue: p.plannedDue, status: 'todo', createdAt: this.now(), createdBy: this.userId, source: p.source,
      startedAt: null, finishedAt: null, waitReason: null, comments: [], evidence: [], reviewResult: null, returnCount: 0, period: this.today().slice(0, 7),
    };
    this.db.tasks.push(t);
    this.event(t, 'created', null, 'todo', `Көзі: ${p.source}`);
    if (p.findingId) {
      const f = this.db.findings.find((x) => x.id === p.findingId)!;
      f.taskId = t.id;
      f.assigneeId = p.assigneeId;
      f.dueDate = p.plannedDue;
      f.history.push({ at: this.now(), by: this.userId, from: f.status, to: f.status, note: `Тапсырма берілді: ${this.userName(p.assigneeId)}, мерзімі ${p.plannedDue}` });
    }
    this.audit('task_create', 'Task', t.id, tenantId, `${t.title} → ${this.userName(t.assigneeId)}`);
    this.commit();
    return t;
  }
  createTaskFromFinding(findingId: ID, p: { assigneeId: ID; reviewerId: ID | null; plannedDue: string; complexity: Complexity; note: string }) {
    const f = this.finding(findingId);
    return this.createTask(f.tenantId, {
      title: f.title,
      description: `${f.actionNeeded}${p.note ? `\n\nТапсырма берушінің ескертпесі: ${p.note}` : ''}`,
      opType: RULES.find((r) => r.id === f.ruleId)?.name ?? 'Тексеру',
      assigneeId: p.assigneeId,
      reviewerId: p.reviewerId,
      plannedDue: p.plannedDue,
      complexity: p.complexity,
      findingId,
      docIds: f.docIds,
      source: 'finding',
    });
  }
  private syncFinding(t: Task, to: TaskStatus, note?: string) {
    if (!t.findingId) return;
    const target = findingStatusForTask(to);
    if (!target) return;
    const linked = this.db.findings.filter((f) => f.taskId === t.id || f.id === t.findingId);
    for (const f of linked) {
      if (f.status === target || f.status === 'not_an_error' || f.status === 'closed') continue;
      try {
        const roles: Role[] = target === 'approved' ? ['chief_accountant'] : ['accountant'];
        let fixEvidence = f.fixEvidence;
        if (target === 'fix_proposed') fixEvidence = t.evidence.map((e) => e.text).join(' | ');
        const next = transitionFinding(f, { to: target, by: this.userId, roles, at: this.now(), note: note ?? `Тапсырма: ${t.title}`, fixEvidence });
        if (target === 'fix_proposed' && t.evidence.some((e) => e.kind === 'source_fix')) next.sourceFixPending = true;
        this.replaceFinding(next);
      } catch {
        /* ауысу мүмкін емес болса — мәселе өз бетінше басқарылады */
      }
    }
  }
  transitionTask(id: ID, to: TaskStatus, note?: string) {
    const t = this.task(id);
    if (to === 'done' || to === 'returned') return this.reviewTask(id, to === 'done' ? 'accepted' : 'returned', note ?? '');
    const isClient = this.roles(t.tenantId).some((r) => r === 'client_manager' || r === 'owner');
    if (!isClient) this.require('tasks.work', t.tenantId, 'Task');
    const prev = t.status;
    const next = transitionTask(t, { to, by: this.userId, roles: this.roles(t.tenantId), at: this.now(), note });
    Object.assign(t, next);
    this.event(t, 'status', prev, to, note);
    this.syncFinding(t, to, note);
    this.audit('task_status', 'Task', id, t.tenantId, `→ ${to}${note ? ` · ${note}` : ''}`);
    this.commit();
    return t;
  }
  reviewTask(id: ID, decision: 'accepted' | 'returned', note: string) {
    const t = this.task(id);
    this.require('tasks.review', t.tenantId, 'Review');
    const to: TaskStatus = decision === 'accepted' ? 'done' : 'returned';
    const next = transitionTask(t, { to, by: this.userId, roles: this.roles(t.tenantId), at: this.now(), note });
    Object.assign(t, next);
    const attempt = this.db.reviews.filter((r) => r.taskId === id).length + 1;
    this.db.reviews.push({ id: this.nextId('rv'), tenantId: t.tenantId, taskId: id, reviewerId: this.userId, decision, note, at: this.now(), attempt });
    this.event(t, 'review', 'in_review', to, note);
    this.syncFinding(t, to, note);
    this.audit('task_review', 'Task', id, t.tenantId, `${decision === 'accepted' ? 'Қабылданды' : 'Кері қайтарылды'}${note ? ` · ${note}` : ''}`);
    this.commit();
    return t;
  }
  addComment(id: ID, text: string) {
    const t = this.task(id);
    if (!text.trim()) throw new WorkflowError('Пікір бос');
    t.comments.push({ id: this.nextId('c'), at: this.now(), by: this.userId, text: text.trim() });
    this.event(t, 'comment', null, null, text.trim().slice(0, 80));
    this.audit('task_comment', 'Task', id, t.tenantId, text.trim().slice(0, 80));
    this.commit();
  }
  addEvidence(id: ID, kind: TaskEvidence['kind'], text: string, docId: ID | null = null) {
    const t = this.task(id);
    const roles = this.roles(t.tenantId);
    if (t.assigneeId !== this.userId && !roles.includes('chief_accountant') && t.clientAssigneeId !== this.userId) throw new ForbiddenError('Дәлелді тек орындаушы қоса алады');
    if (text.trim().length < 5) throw new WorkflowError('Дәлелді нақты сипаттаңыз (кемінде 5 таңба)');
    t.evidence.push({ id: this.nextId('ev'), at: this.now(), by: this.userId, kind, text: text.trim(), docId });
    this.event(t, 'evidence', null, null, text.trim().slice(0, 80));
    this.audit('task_evidence', 'Task', id, t.tenantId, `${kind}: ${text.trim().slice(0, 80)}`);
    this.commit();
  }
  logWork(id: ID, minutes: number) {
    const t = this.task(id);
    if (t.assigneeId !== this.userId) throw new ForbiddenError('Уақытты тек орындаушы жаза алады');
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 600) throw new WorkflowError('Минут 1–600 аралығында');
    this.db.workLogs.push({ id: this.nextId('wl'), tenantId: t.tenantId, taskId: id, userId: this.userId, date: this.today(), minutes });
    this.audit('worklog', 'Task', id, t.tenantId, `${minutes} мин`);
    this.commit();
  }
  ownerDecision(id: ID, decision: 'approved' | 'rejected', note: string) {
    const t = this.task(id);
    this.require('decisions.approve', t.tenantId, 'Decision');
    if (!t.needsOwnerDecision || t.ownerDecision) throw new WorkflowError('Бұл тапсырма шешім күтпейді');
    if (note.trim().length < 3) throw new WorkflowError('Шешімге қысқа түсініктеме жазыңыз');
    t.ownerDecision = { decision, by: this.userId, at: this.now(), note: note.trim() };
    t.comments.push({ id: this.nextId('c'), at: this.now(), by: this.userId, text: `Шешім: ${decision === 'approved' ? 'Бекітілді' : 'Қабылданбады'} — ${note.trim()}` });
    this.event(t, 'decision', null, decision, note.trim());
    // Шешімнен кейін жұмыс орындаушыға қайтады
    if (t.status === 'waiting_client') {
      t.status = 'in_progress';
      t.waitReason = null;
      this.event(t, 'status', 'waiting_client', 'in_progress', 'Кәсіп иесінің шешімі алынды');
      this.syncFinding(t, 'in_progress');
    }
    const xp = this.db.agreements.flatMap((a) => a.extraWorkProposals).find((p) => p.status === 'sent' && t.title.includes(String(p.units)));
    if (xp) xp.status = decision === 'approved' ? 'accepted' : 'declined';
    this.audit('owner_decision', 'Task', id, t.tenantId, `${decision}: ${note.trim()}`);
    this.commit();
    return t;
  }
  bulkAssign(ids: ID[], assigneeId: ID) {
    for (const id of ids) {
      const t = this.task(id);
      this.require('tasks.assign', t.tenantId, 'Task');
      const ok = this.db.memberships.some((m) => m.userId === assigneeId && m.tenantId === t.tenantId && !m.revokedAt && ['accountant', 'chief_accountant'].includes(m.role));
      if (!ok) throw new WorkflowError(`${this.userName(assigneeId)} «${t.title}» компаниясына бекітілмеген`);
    }
    for (const id of ids) {
      const t = this.db.tasks.find((x) => x.id === id)!;
      const from = t.assigneeId;
      t.assigneeId = assigneeId;
      this.event(t, 'assigned', from, assigneeId);
      this.audit('task_assign', 'Task', id, t.tenantId, `${this.userName(from)} → ${this.userName(assigneeId)}`);
    }
    this.commit();
  }
  duplicates() {
    return duplicateTasks(this.db, this.tenants().filter((t) => this.can('tasks.read_all', t.id)).map((t) => t.id));
  }

  // ───────── Команда / KPI ─────────
  team(periodKey: string) {
    const per = findPeriod(periodKey);
    // KPI кезеңі: ай/тоқсан — ай соңына дейін, күн/апта — бүгінге дейін (бүгінгі жұмыс та кіреді)
    const p = { from: per.from, to: per.kind === 'month' || per.kind === 'quarter' ? monthEnd(per.to.slice(0, 7)) : this.today() };
    const tenants = this.tenants().map((t) => t.id);
    const canAll = tenants.some((t) => this.can('tasks.read_all', t));
    if (!canAll && !this.canAnywhere('team.read')) throw new ForbiddenError('Команда экранына рұқсат жоқ');
    const accIds = [...new Set(this.db.memberships.filter((m) => m.role === 'accountant' && !m.revokedAt && m.tenantId && tenants.includes(m.tenantId)).map((m) => m.userId))];
    const visible = canAll ? accIds : accIds.filter((id) => id === this.userId);
    return visible.map((id) => ({ user: this.db.users.find((u) => u.id === id)!, kpi: accountantKpi(this.db, id, p.from, p.to, this.now(), this.today()) }));
  }
  setComplexityWeights(w: Record<Complexity, number>) {
    if (!this.canAnywhere('kpi.config')) throw new ForbiddenError('Коэффициенттерді тек қызмет жетекшісі баптайды');
    for (const k of ['simple', 'standard', 'complex'] as Complexity[]) if (!(w[k] > 0 && w[k] <= 20)) throw new WorkflowError('Коэффициент 0-ден 20-ға дейін');
    this.db.settings.complexityWeights = { ...w };
    this.audit('kpi_weights', 'Settings', null, null, JSON.stringify(w));
    this.commit();
  }
  addLeadAssessment(userId: ID, period: string, note: string) {
    if (!this.canAnywhere('kpi.config')) throw new ForbiddenError('Бағалауды тек қызмет жетекшісі жазады');
    if (note.trim().length < 10) throw new WorkflowError('Бағалауды толығырақ жазыңыз (кемінде 10 таңба)');
    this.db.leadAssessments = this.db.leadAssessments ?? [];
    this.db.leadAssessments.push({ id: this.nextId('la'), userId, period, note: note.trim(), by: this.userId, at: this.now() });
    this.audit('lead_assessment', 'User', userId, null, period);
    this.commit();
  }
  weight(c: Complexity) {
    return weightOf(this.db, c);
  }

  // ───────── Кезең жабу ─────────
  periodClose(tenantId: ID, period: string) {
    this.tenant(tenantId);
    if (!this.can('findings.read', tenantId)) this.require('finance.read', tenantId, 'PeriodClose');
    let pc = this.db.periodCloses.find((p) => p.tenantId === tenantId && p.period === period);
    if (!pc) {
      pc = { id: this.nextId('pc'), tenantId, period, status: 'open', checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c, done: false, by: null, at: null, note: '' })), incomeTaxAccrual: null, closedBy: null, closedAt: null, approvedBy: null };
      this.db.periodCloses.push(pc);
    }
    const blockers = this.db.findings.filter((f) => f.tenantId === tenantId && f.period === period && (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status) && RULES.find((r) => r.id === f.ruleId)?.blocksPeriodClose);
    const required = pc.checklist.filter((c) => c.required);
    return { pc, blockers, readyPct: required.length ? Math.round((required.filter((c) => c.done).length / required.length) * 100) : 100 };
  }
  toggleChecklist(tenantId: ID, period: string, itemId: string, note = '') {
    this.require('findings.work', tenantId, 'PeriodClose');
    const { pc } = this.periodClose(tenantId, period);
    if (pc.status === 'closed') throw new WorkflowError('Кезең жабылған — өзгерту үшін бас бухгалтер қайта ашуы керек');
    const it = pc.checklist.find((c) => c.id === itemId)!;
    it.done = !it.done;
    it.by = it.done ? this.userId : null;
    it.at = it.done ? this.now() : null;
    it.note = note;
    if (pc.status === 'open') pc.status = 'in_progress';
    this.audit('checklist', 'PeriodClose', pc.id, tenantId, `${it.label}: ${it.done ? 'иә' : 'жоқ'}`);
    this.commit();
  }
  addChecklistItem(tenantId: ID, period: string, label: string, required: boolean) {
    this.require('close.manage', tenantId, 'PeriodClose');
    const { pc } = this.periodClose(tenantId, period);
    if (label.trim().length < 5) throw new WorkflowError('Пункт атауы тым қысқа');
    pc.checklist.push({ id: this.nextId('ci'), label: label.trim(), required, done: false, by: null, at: null, note: '' });
    this.audit('checklist_config', 'PeriodClose', pc.id, tenantId, `+ ${label}`);
    this.commit();
  }
  closePeriod(tenantId: ID, period: string, incomeTax: Money) {
    this.require('close.manage', tenantId, 'PeriodClose');
    const { pc, blockers } = this.periodClose(tenantId, period);
    if (monthEnd(period) > this.lastDataDay(tenantId)) throw new WorkflowError('Ай әлі аяқталмаған немесе деректер толық синхрондалмаған');
    const missing = pc.checklist.filter((c) => c.required && !c.done);
    if (missing.length) throw new WorkflowError(`Чек-лист аяқталмаған: ${missing.map((m) => m.label).join('; ')}`);
    if (blockers.length) throw new WorkflowError(`Кедергі мәселелер ашық: ${blockers.map((b) => b.title).join('; ')}`);
    if (!Number.isSafeInteger(incomeTax) || incomeTax < 0) throw new WorkflowError('Салық сомасы дұрыс емес');
    pc.status = 'closed';
    pc.incomeTaxAccrual = incomeTax;
    pc.closedBy = this.userId;
    pc.closedAt = this.now();
    pc.approvedBy = this.userId;
    this.audit('period_close', 'PeriodClose', pc.id, tenantId, `${period} жабылды`);
    this.commit();
  }

  // ───────── Қызмет және төлем ─────────
  agreement(tenantId: ID): ServiceAgreement {
    this.tenant(tenantId);
    if (!this.can('service.view', tenantId) && !this.can('tasks.read_all', tenantId) && !this.can('findings.work', tenantId)) this.require('service.view', tenantId, 'ServiceAgreement');
    return this.db.agreements.find((a) => a.tenantId === tenantId)!;
  }
  subscription(tenantId: ID) {
    this.tenant(tenantId);
    return this.db.subscriptions.find((s) => s.tenantId === tenantId) ?? null;
  }
  usage(tenantId: ID, month: string) {
    const a = this.db.agreements.find((x) => x.tenantId === tenantId);
    const tasks = this.db.tasks.filter((t) => t.tenantId === tenantId && t.status !== 'cancelled' && (t.period === month || (t.finishedAt && almatyDate(t.finishedAt).startsWith(month))));
    const units = sum(tasks.map((t) => weightOf(this.db, t.complexity)));
    return { units, limit: a?.includedUnitsPerMonth ?? 0, over: Math.max(0, units - (a?.includedUnitsPerMonth ?? 0)), tasks: tasks.length };
  }
  economics(periodKey: string) {
    if (!this.canAnywhere('service.economics')) throw new ForbiddenError('Қызмет экономикасы тек қызмет жетекшісіне');
    const p = findPeriod(periodKey);
    const months = monthsBetween(p.from, p.to).length;
    return this.tenants()
      .filter((t) => this.can('service.economics', t.id))
      .map((t) => {
        const a = this.db.agreements.find((x) => x.tenantId === t.id)!;
        const minutes = this.db.workLogs.filter((w) => w.tenantId === t.id && w.date >= p.from && w.date <= p.to).reduce((s, w) => s + w.minutes, 0);
        const revenue = a.monthlyFee === null ? null : a.monthlyFee * months;
        const labor = mulDiv(a.directCosts.hourlyLaborCost, minutes, 60);
        const integ = a.directCosts.integrationAndAi * months;
        const other = a.directCosts.other * months;
        const margin = revenue === null ? null : revenue - labor - integ - other;
        return { tenant: t, agreement: a, hours: Math.round(minutes / 6) / 10, revenue, labor, integ, other, margin, marginBp: revenue ? Math.round(((margin as number) * 10000) / revenue) : null, usage: this.usage(t.id, p.to.slice(0, 7)) };
      });
  }
  proposeExtraWork(tenantId: ID, units: number, note: string) {
    this.require('service.economics', tenantId, 'ServiceAgreement');
    const a = this.agreement(tenantId);
    const xp = { id: this.nextId('xp'), period: this.today().slice(0, 7), units, amount: null, status: 'sent' as const, note };
    a.extraWorkProposals.push(xp);
    const owner = this.db.memberships.find((m) => m.tenantId === tenantId && m.role === 'owner' && !m.revokedAt);
    const t: Task = {
      id: this.nextId('task'), tenantId, title: `Лимиттен тыс жұмыс ұсынысын қарау (${units} бірлік)`, opType: 'Шешім', description: `${note}\nҚосымша төлем тек сіз бекіткен соң есептеледі. Сома — жеке есептеледі.`, findingId: null, docIds: [],
      assigneeId: this.userId, reviewerId: this.userId, clientAssigneeId: owner?.userId ?? null, complexity: 'simple', plannedDue: addDays(this.today(), 5), status: 'waiting_client', createdAt: this.now(), createdBy: this.userId, source: 'decision',
      startedAt: this.now(), finishedAt: null, waitReason: 'Кәсіп иесінің шешімі күтілуде', comments: [], evidence: [], reviewResult: null, returnCount: 0, needsOwnerDecision: true, ownerDecision: null, period: this.today().slice(0, 7),
    };
    this.db.tasks.push(t);
    this.event(t, 'created', null, 'waiting_client');
    this.audit('extra_work_proposal', 'ServiceAgreement', a.id, tenantId, `${units} бірлік`);
    this.commit();
    return xp;
  }

  // ───────── Интеграциялар ─────────
  connections() {
    return this.tenants()
      .filter((t) => this.can('integration.read', t.id) || this.can('finance.read', t.id))
      .map((t) => ({ tenant: t, conn: this.db.connections.find((c) => c.tenantId === t.id) ?? null, runs: this.db.syncRuns.filter((r) => r.tenantId === t.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), freshness: dataFreshness(this.db, t.id, this.now()), queued: this.db.mockSourceQueue.filter((q) => q.tenantId === t.id).reduce((s, q) => s + q.transactions.length, 0) }));
  }
  private requireSync(tenantId: ID) {
    if (!this.can('integration.manage', tenantId) && !this.can('close.manage', tenantId) && !this.can('findings.work', tenantId)) this.require('integration.manage', tenantId, 'SyncRun');
  }
  runSync(tenantId: ID) {
    this.tenant(tenantId);
    this.requireSync(tenantId);
    const conn = this.db.connections.find((c) => c.tenantId === tenantId);
    if (!conn) throw new WorkflowError('Қосылым бапталмаған. CSV импортын қолданыңыз.');
    const connector = CONNECTORS[conn.method];
    if (!connector) throw new WorkflowError(`${conn.method} үшін адаптер жоқ`);
    const runs = [];
    let attempt = 1;
    for (; attempt <= 3; attempt++) {
      const t = connector.testConnection(conn, attempt);
      conn.lastAttemptAt = this.now();
      if (t.ok) break;
      runs.push(this.pushRun({ tenantId, connectionId: conn.id, kind: 'incremental', startedAt: this.now(), finishedAt: this.now(), status: 'retrying', attempt, received: 0, created: 0, updated: 0, duplicatesSkipped: 0, error: t.error }));
    }
    if (attempt > 3) {
      conn.status = 'error';
      this.audit('sync', 'SyncRun', null, tenantId, 'Сәтсіз (3 әрекет)', 'error');
      this.commit();
      return runs;
    }
    const r = connector.pullIncremental(this.db, conn);
    conn.lastSuccessAt = this.now();
    conn.status = 'ok';
    runs.push(this.pushRun({ tenantId, connectionId: conn.id, kind: 'incremental', startedAt: this.now(), finishedAt: this.now(), status: 'success', attempt, ...r, note: connector.isMock ? 'MockConnector: demo дерек' : undefined }));
    // Синхрондаудан кейін тексерулер автоматты түрде қайта іске қосылады
    runChecks(this.db, tenantId, this.lastDataDay(tenantId), this.now(), () => this.nextId('f'));
    // Кеш синхрондау мәселесі шешілсе — автоматты қайта тексеру нәтижесі жазылады (жабу — адам шешімі)
    for (const f of this.db.findings.filter((x) => x.tenantId === tenantId && x.ruleId === 'R11' && x.status !== 'closed' && x.status !== 'not_an_error')) {
      f.recheck = { at: this.now(), passed: true, detail: 'Синхрондау сәтті: деректер жаңартылды.', syncRunId: runs[runs.length - 1].id };
      f.fixEvidence = f.fixEvidence ?? 'Синхрондау қайта іске қосылды (SyncRun журналы)';
    }
    this.audit('sync', 'SyncRun', runs[runs.length - 1].id, tenantId, `Алынды ${r.received}, жаңа ${r.created}, дубль өткізілді ${r.duplicatesSkipped}`);
    this.commit();
    return runs;
  }
  private pushRun(p: Omit<import('../domain/types').SyncRun, 'id'>) {
    const run = { id: this.nextId('sync'), ...p };
    this.db.syncRuns.push(run);
    return run;
  }
  importCsv(tenantId: ID, text: string) {
    this.tenant(tenantId);
    this.requireSync(tenantId);
    const res = importCsv(this.db, tenantId, text, () => this.nextId('csv'));
    const conn = this.db.connections.find((c) => c.tenantId === tenantId);
    this.pushRun({ tenantId, connectionId: conn?.id ?? 'csv', kind: 'csv_import', startedAt: this.now(), finishedAt: this.now(), status: res.errors.length ? (res.created + res.updated ? 'partial' : 'failed') : 'success', attempt: 1, received: res.received, created: res.created, updated: res.updated, duplicatesSkipped: res.duplicatesSkipped, error: res.errors.map((e) => `жол ${e.line}: ${e.message}`).join('; ') || undefined, note: 'CSV demo-импорт' });
    if (res.created + res.updated) runChecks(this.db, tenantId, this.lastDataDay(tenantId), this.now(), () => this.nextId('f'));
    this.audit('csv_import', 'SyncRun', null, tenantId, `жаңа ${res.created}, жаңартылды ${res.updated}, дубль ${res.duplicatesSkipped}, қате ${res.errors.length}`);
    this.commit();
    return res;
  }
  updateConnection(tenantId: ID, p: { method: ConnectionMethod; configuration: string; version: string; hosting: import('../domain/types').IntegrationConnection['hosting'] }) {
    this.require('integration.manage', tenantId, 'IntegrationConnection');
    const c = this.db.connections.find((x) => x.tenantId === tenantId);
    if (!c) throw new WorkflowError('Қосылым жоқ');
    Object.assign(c, p, { adapter: p.method === 'mock' ? 'MockConnector' : p.method === 'csv' ? 'CSV импорт' : `${p.method} адаптер (кейінгі кезең — іске асырылмаған)` });
    this.audit('connection_update', 'IntegrationConnection', c.id, tenantId, `${p.method}`);
    this.commit();
  }

  // ───────── AI ─────────
  ask(tenantId: ID, question: string): AiAnswer {
    this.tenant(tenantId);
    this.require('ai.ask', tenantId, 'AI');
    if (question.trim().length < 3) throw new WorkflowError('Сұрақты жазыңыз');
    const a = askAi(this.db, tenantId, question.slice(0, 500), this.now(), this.lastDataDay(tenantId) < this.today() ? addDays(this.lastDataDay(tenantId), 0) : this.today());
    this.audit('ai_question', 'AI', null, tenantId, `intent=${a.intent}; жіберілген дерек: ${a.dataSent.join(', ')}`);
    this.commit();
    return a;
  }

  // ───────── Клиентті қосу ─────────
  onboard(p: OnboardInput) {
    if (!this.canAnywhere('onboarding')) throw new ForbiddenError('Клиентті қосу тек қызмет жетекшісіне');
    const tid = this.nextId('t');
    const now = this.now();
    this.db.tenants.push({ id: tid, name: p.companyName, industry: p.industry, serviceMode: p.serviceMode, isDemo: true, status: 'onboarding', createdAt: now, contactPerson: p.contactPerson, contactPhone: p.contactPhone, description: p.description });
    this.db.legalEntities.push({ id: this.nextId('le'), tenantId: tid, name: p.legalName || p.companyName, bin: p.bin || '—', taxRegimeNote: 'Жергілікті маман растайды' });
    p.branches.filter((b) => b.trim()).forEach((name) => this.db.branches.push({ id: this.nextId('b'), tenantId: tid, name: name.trim(), kind: 'store', city: '', openingInventory: 0 }));
    this.db.accounts.push({ id: this.nextId('acc'), tenantId: tid, branchId: null, kind: 'bank', name: 'Банк шоты (бапталмаған)', openingBalance: 0 });
    this.db.connections.push({ id: this.nextId('ic'), tenantId: tid, configuration: p.oneC.configuration, version: p.oneC.version, hosting: p.oneC.hosting, method: p.oneC.method, mode: 'read_only', adapter: p.oneC.method === 'mock' ? 'MockConnector' : p.oneC.method === 'csv' ? 'CSV импорт' : `${p.oneC.method} адаптер (кейінгі кезең)`, isMock: p.oneC.method === 'mock', status: 'not_connected', lastSuccessAt: null, lastAttemptAt: null, fieldMapping: {}, hasSourceAuditInfo: false, licenseNote: '1С лицензиясы клиенттікі (жеке шарт)' });
    const ownerId = this.nextId('u');
    this.db.users.push({ id: ownerId, name: p.contactPerson, title: `Кәсіп иесі · ${p.companyName}`, email: p.contactEmail || `${ownerId}@demo.kz`, mfaEnabled: false, active: true });
    const ms: [ID, Role][] = [[ownerId, 'owner'], [p.accountantId, 'accountant'], [p.reviewerId, 'chief_accountant'], [this.userId, 'service_lead'], ['u_int', 'integrator']];
    if (p.reviewerId !== 'u_chief') ms.push(['u_chief', 'chief_accountant']);
    for (const [u, r] of ms) if (!this.db.memberships.some((m) => m.userId === u && m.tenantId === tid && m.role === r)) this.db.memberships.push({ id: this.nextId('m'), userId: u, tenantId: tid, role: r, financeAccess: r === 'integrator' ? false : undefined });
    const fee = p.tariff === 'control' ? null : p.monthlyFee;
    this.db.agreements.push({
      id: this.nextId('sa'), tenantId: tid, tariff: p.tariff, mode: p.serviceMode, monthlyFee: fee, includedUnitsPerMonth: p.includedUnits, includedWorks: p.includedWorks, excludedWorks: p.excludedWorks,
      clientDocuments: p.clientDocuments, clientDuties: p.clientDuties, ourDuties: p.ourDuties, responsibleAccountantId: p.accountantId, reviewerId: p.reviewerId, serviceLeadId: this.userId,
      slaResponseHours: p.slaHours, startDate: p.startDate, restoration: p.restorationNeeded ? { needed: true, estimateHours: p.restorationHours, fee: null, status: 'estimate' } : { needed: false, estimateHours: null, fee: null, status: 'not_needed' },
      directCosts: { hourlyLaborCost: 450_000, integrationAndAi: 2_500_000, other: 1_000_000 }, extraWorkProposals: [],
    });
    this.db.subscriptions.push({ id: this.nextId('sub'), tenantId: tid, tariff: p.tariff, status: 'trial', since: p.startDate, oneCLicense: 'Клиенттің өз лицензиясы — біздің жазылымға кірмейді' });
    const m = this.today().slice(0, 7);
    this.db.periodCloses.push({ id: this.nextId('pc'), tenantId: tid, period: m, status: 'open', checklist: DEFAULT_CHECKLIST.filter((c) => p.checklist.includes(c.id)).map((c) => ({ ...c, done: false, by: null, at: null, note: '' })), incomeTaxAccrual: null, closedBy: null, closedAt: null, approvedBy: null });
    const t: Task = {
      id: this.nextId('task'), tenantId: tid, title: 'Бастапқы диагностика: 1С қолжетімділігі және есеп жағдайы', opType: 'Диагностика', description: `Диагностика нәтижесі:\n${p.diagnostics.join('\n')}`, findingId: null, docIds: [],
      assigneeId: p.accountantId, reviewerId: p.reviewerId, complexity: 'complex', plannedDue: addDays(this.today(), 5), status: 'todo', createdAt: now, createdBy: this.userId, source: 'manual',
      startedAt: null, finishedAt: null, waitReason: null, comments: [], evidence: [], reviewResult: null, returnCount: 0, period: m,
    };
    this.db.tasks.push(t);
    this.event(t, 'created', null, 'todo');
    this.audit('onboard_client', 'Tenant', tid, tid, `${p.companyName}; тариф ${p.tariff}; режим ${p.serviceMode}`);
    this.commit();
    return { tenantId: tid, ownerId };
  }

  // ───────── Әкімші ─────────
  adminUsers() {
    if (!this.canAnywhere('admin.users')) throw new ForbiddenError('Тек платформа әкімшісі');
    return { users: this.db.users, memberships: this.db.memberships, tenants: this.db.tenants.map((t) => ({ id: t.id, name: t.name, status: t.status })) };
  }
  grantAccess(userId: ID, tenantId: ID, role: Role, hours: number | null, reason: string) {
    if (!this.canAnywhere('admin.users')) throw new ForbiddenError('Тек платформа әкімшісі');
    if (reason.trim().length < 10) throw new WorkflowError('Рұқсат беру себебін жазыңыз (кемінде 10 таңба)');
    if (role === 'platform_admin') throw new WorkflowError('Әкімші рөлі tenant ішінде берілмейді');
    const m = { id: this.nextId('m'), userId, tenantId, role, expiresAt: hours ? new Date(new Date(this.now()).getTime() + hours * 3600000).toISOString() : undefined, financeAccess: role === 'integrator' ? false : undefined };
    this.db.memberships.push(m);
    this.audit('access_grant', 'Membership', m.id, tenantId, `${this.userName(userId)} → ${role}${hours ? ` (${hours} сағ)` : ''} · ${reason}`);
    this.commit();
    return m;
  }
  revokeAccess(membershipId: ID) {
    if (!this.canAnywhere('admin.users')) throw new ForbiddenError('Тек платформа әкімшісі');
    const m = this.db.memberships.find((x) => x.id === membershipId);
    if (!m) throw new WorkflowError('Табылмады');
    m.revokedAt = this.now();
    this.audit('access_revoke', 'Membership', m.id, m.tenantId, `${this.userName(m.userId)} · ${m.role}`);
    this.commit();
  }
  toggleFinanceAccess(membershipId: ID) {
    if (!this.canAnywhere('admin.users')) throw new ForbiddenError('Тек платформа әкімшісі');
    const m = this.db.memberships.find((x) => x.id === membershipId)!;
    m.financeAccess = !m.financeAccess;
    this.audit('finance_access', 'Membership', m.id, m.tenantId, `${this.userName(m.userId)}: ${m.financeAccess ? 'берілді' : 'алынды'}`);
    this.commit();
  }
  toggleMfa(userId: ID) {
    if (userId !== this.userId && !this.canAnywhere('admin.users')) throw new ForbiddenError('Рұқсат жоқ');
    const u = this.db.users.find((x) => x.id === userId)!;
    u.mfaEnabled = !u.mfaEnabled;
    this.audit('mfa_toggle', 'User', userId, null, `${u.mfaEnabled ? 'қосылды' : 'өшірілді'} (demo: нақты MFA жоқ)`);
    this.commit();
  }
  setPlatformName(name: string) {
    if (!this.canAnywhere('settings.platform') && !this.canAnywhere('kpi.config')) throw new ForbiddenError('Атауды тек әкімші немесе қызмет жетекшісі өзгертеді');
    if (name.trim().length < 2) throw new WorkflowError('Атау тым қысқа');
    this.db.settings.platformName = name.trim();
    this.audit('settings', 'Settings', null, null, `Платформа атауы: ${name.trim()}`);
    this.commit();
  }

  auditLog(tenantId: ID | null) {
    if (tenantId) {
      this.tenant(tenantId);
      this.require('audit.read', tenantId, 'AuditEvent');
      return this.db.audit.filter((a) => a.tenantId === tenantId);
    }
    if (!this.canAnywhere('admin.users')) {
      const ids = this.tenants().filter((t) => this.can('audit.read', t.id)).map((t) => t.id);
      return this.db.audit.filter((a) => (a.tenantId && ids.includes(a.tenantId)) || a.userId === this.userId);
    }
    // Әкімші: барлық оқиға, бірақ «details» ішіндегі сомалар жасырылады
    return this.db.audit.map((a) => ({ ...a, details: a.details.replace(/[\d\s]{4,}₸/g, '*** ₸') }));
  }

  exportTenant(tenantId: ID): string {
    this.tenant(tenantId);
    const r = this.roles(tenantId);
    if (!r.includes('owner') && !r.includes('service_lead')) throw new ForbiddenError('Экспорт тек кәсіп иесіне немесе қызмет жетекшісіне');
    const pick = <T extends { tenantId?: ID | null }>(arr: T[]) => arr.filter((x) => x.tenantId === tenantId);
    const data = {
      exportedAt: this.now(), note: 'DEMO экспорт. Тек осы компанияның деректері.', tenant: this.db.tenants.find((t) => t.id === tenantId), branches: pick(this.db.branches), accounts: pick(this.db.accounts), counterparties: pick(this.db.counterparties),
      documents: pick(this.db.documents), transactions: pick(this.db.transactions), findings: pick(this.db.findings), tasks: pick(this.db.tasks), periodCloses: pick(this.db.periodCloses), agreement: this.db.agreements.find((a) => a.tenantId === tenantId), audit: pick(this.db.audit),
    };
    this.audit('data_export', 'Tenant', tenantId, tenantId, 'JSON экспорт');
    this.commit();
    return JSON.stringify(data, null, 2);
  }

  memberships() {
    return activeMemberships(this.db, this.userId, this.now());
  }
}

export interface OnboardInput {
  companyName: string;
  legalName: string;
  bin: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  description: string;
  industry: 'retail' | 'wholesale';
  serviceMode: 'control' | 'outsourcing';
  branches: string[];
  oneC: { configuration: string; version: string; hosting: import('../domain/types').IntegrationConnection['hosting']; method: ConnectionMethod };
  volumes: { bankAccounts: number; cashRegisters: number; warehouses: number; docsPerMonth: number; employees: number };
  accountingState: 'good' | 'partial' | 'neglected';
  restorationNeeded: boolean;
  restorationHours: number | null;
  tariff: TariffCode;
  monthlyFee: Money | null;
  includedUnits: number;
  includedWorks: string[];
  excludedWorks: string[];
  clientDocuments: { name: string; deadline: string }[];
  clientDuties: string[];
  ourDuties: string[];
  accessConfirmed: boolean;
  checklist: string[];
  diagnostics: string[];
  accountantId: ID;
  reviewerId: ID;
  slaHours: number;
  startDate: string;
}

export type FinanceBundle = ReturnType<Api['finance']>;
export type { Period };
export { monthStart, diffDays };
