/**
 * Команда KPI. Құжат саны бойынша бағаламаймыз — сапа, мерзім және күрделілік ескеріледі.
 * Әр көрсеткіштің формуласы, кезеңі және дереккөзі бар. Жалақыға автоматты әсер ЕТПЕЙДІ.
 */
import type { Db, ID, ISODate, Task, Complexity } from './types';
import { diffDays, monthEnd, hoursBetween, almatyDate } from './periods';
import { OPEN_FINDING_STATUSES } from './checks';

export interface KpiDef {
  key: string;
  label: string;
  formula: string;
  source: string;
  better: 'higher' | 'lower';
  unit: '%' | 'күн' | 'сағ' | 'бірлік' | 'дана';
}

export const KPI_DEFS: KpiDef[] = [
  { key: 'onTime', label: 'Мерзімінде орындалған', formula: 'Мерзімінде қабылданған тапсырмалар / кезеңде мерзімі келген тапсырмалар × 100', source: 'Task.plannedDue, Task.finishedAt', better: 'higher', unit: '%' },
  { key: 'firstPass', label: 'Бірінші тексеруден өткен', formula: 'returnCount = 0 болып қабылданған / барлық қабылданған × 100', source: 'Review, Task.returnCount', better: 'higher', unit: '%' },
  { key: 'rework', label: 'Қайта түзетуге кеткен', formula: 'Кемінде бір рет қайтарылған / тексеруден өткен тапсырмалар × 100', source: 'Review (decision = returned)', better: 'lower', unit: '%' },
  { key: 'closeDays', label: 'Ай жабу мерзімі', formula: 'Жабылған күн − ай соңы (бекітілген клиенттер бойынша орташа)', source: 'PeriodClose.closedAt', better: 'lower', unit: 'күн' },
  { key: 'openIssues', label: 'Ашық мәселелер', formula: 'Жауапты болып тұрған ашық Finding саны', source: 'Finding.assigneeId, status', better: 'lower', unit: 'дана' },
  { key: 'issueAge', label: 'Ашық мәселелердің орташа жасы', formula: 'Σ(бүгін − detectedAt) / ашық мәселелер саны', source: 'Finding.detectedAt', better: 'lower', unit: 'күн' },
  { key: 'weightedVolume', label: 'Күрделілікке қарай көлем', formula: 'Σ күрделілік коэффициенті (қабылданған тапсырмалар)', source: 'Task.complexity × Settings.complexityWeights (demo)', better: 'higher', unit: 'бірлік' },
  { key: 'hours', label: 'Нақты жұмыс уақыты', formula: 'Σ WorkLog.minutes / 60', source: 'WorkLog', better: 'higher', unit: 'сағ' },
  { key: 'clientWait', label: 'Клиентті күтуден кешігу', formula: 'Σ «Клиент жауабын күтуде» мәртебесіндегі күндер', source: 'TaskEvent (status → waiting_client)', better: 'lower', unit: 'күн' },
  { key: 'responseHours', label: 'Клиентке жауап беру уақыты', formula: 'Клиент пікірінен кейінгі бухгалтердің алғашқы жауабына дейінгі орташа сағат', source: 'Task.comments', better: 'lower', unit: 'сағ' },
];

export interface KpiValue {
  value: number | null;
  n: number; // база (бөлгіш)
}

export function weightOf(db: Db, c: Complexity): number {
  return db.settings.complexityWeights[c];
}

function inRange(iso: string | null, from: ISODate, to: ISODate): boolean {
  if (!iso) return false;
  const d = iso.length > 10 ? almatyDate(iso) : iso;
  return d >= from && d <= to;
}

const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a * 1000) / b) / 10);

export function waitDays(db: Db, t: Task, asOfIso: string): number {
  const ev = db.taskEvents.filter((e) => e.taskId === t.id && e.type === 'status').sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  let start: string | null = null;
  for (const e of ev) {
    if (e.to === 'waiting_client') start = e.at;
    else if (start) {
      total += hoursBetween(start, e.at) / 24;
      start = null;
    }
  }
  if (start) total += hoursBetween(start, asOfIso) / 24;
  return Math.round(total * 10) / 10;
}

export function accountantKpi(db: Db, userId: ID, from: ISODate, to: ISODate, nowIso: string, today: ISODate) {
  const mine = db.tasks.filter((t) => t.assigneeId === userId);
  const dueInPeriod = mine.filter((t) => t.plannedDue >= from && t.plannedDue <= to && (t.status === 'done' || t.plannedDue < today));
  const onTimeDone = dueInPeriod.filter((t) => t.status === 'done' && t.finishedAt && almatyDate(t.finishedAt) <= t.plannedDue);
  const accepted = mine.filter((t) => t.status === 'done' && inRange(t.finishedAt, from, to));
  const reviewed = mine.filter((t) => (t.status === 'done' && inRange(t.finishedAt, from, to)) || (t.returnCount > 0 && db.reviews.some((r) => r.taskId === t.id && inRange(r.at, from, to))));
  const firstPass = accepted.filter((t) => t.returnCount === 0);
  const reworked = reviewed.filter((t) => t.returnCount > 0);

  const tenants = [...new Set(db.memberships.filter((m) => m.userId === userId && m.role === 'accountant' && !m.revokedAt).map((m) => m.tenantId))];
  const closes = db.periodCloses.filter((p) => tenants.includes(p.tenantId) && p.status === 'closed' && p.closedAt && monthEnd(p.period) >= from && monthEnd(p.period) <= to);
  const closeDays = closes.length ? Math.round((closes.reduce((s, p) => s + diffDays(almatyDate(p.closedAt!), monthEnd(p.period)), 0) / closes.length) * 10) / 10 : null;

  const openF = db.findings.filter((f) => f.assigneeId === userId && (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status));
  const age = openF.length ? Math.round((openF.reduce((s, f) => s + diffDays(today, almatyDate(f.detectedAt)), 0) / openF.length) * 10) / 10 : null;

  const weighted = accepted.reduce((s, t) => s + weightOf(db, t.complexity), 0);
  const minutes = db.workLogs.filter((w) => w.userId === userId && w.date >= from && w.date <= to).reduce((s, w) => s + w.minutes, 0);
  const wait = mine.filter((t) => t.plannedDue >= from && t.plannedDue <= to).reduce((s, t) => s + waitDays(db, t, nowIso), 0);

  // Клиент пікіріне жауап уақыты
  const clientIds = new Set(db.memberships.filter((m) => m.role === 'owner' || m.role === 'client_manager').map((m) => m.userId));
  const resp: number[] = [];
  for (const t of mine) {
    const cs = [...t.comments].sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 0; i < cs.length; i++) {
      if (!clientIds.has(cs[i].by) || !inRange(cs[i].at, from, to)) continue;
      const reply = cs.slice(i + 1).find((c) => c.by === userId);
      if (reply) resp.push(hoursBetween(cs[i].at, reply.at));
    }
  }

  const openTasks = mine.filter((t) => !['done', 'cancelled'].includes(t.status));
  const openUnits = openTasks.reduce((s, t) => s + weightOf(db, t.complexity), 0);
  const user = db.users.find((u) => u.id === userId);
  const capacity = user?.capacityUnitsPerMonth ?? null;
  const overdue = openTasks.filter((t) => t.plannedDue < today);

  return {
    values: {
      onTime: { value: pct(onTimeDone.length, dueInPeriod.length), n: dueInPeriod.length },
      firstPass: { value: pct(firstPass.length, accepted.length), n: accepted.length },
      rework: { value: pct(reworked.length, reviewed.length), n: reviewed.length },
      closeDays: { value: closeDays, n: closes.length },
      openIssues: { value: openF.length, n: openF.length },
      issueAge: { value: age, n: openF.length },
      weightedVolume: { value: weighted, n: accepted.length },
      hours: { value: Math.round(minutes / 6) / 10, n: minutes },
      clientWait: { value: Math.round(wait * 10) / 10, n: mine.length },
      responseHours: { value: resp.length ? Math.round((resp.reduce((a, b) => a + b, 0) / resp.length) * 10) / 10 : null, n: resp.length },
    } as Record<string, KpiValue>,
    tenants: tenants as ID[],
    openTasks,
    overdue,
    openUnits,
    capacity,
    loadPct: capacity ? Math.round((openUnits / capacity) * 100) : null,
  };
}

/** Бір нысанға (мәселе/құжат+операция түрі) бірнеше бухгалтерге ашық тапсырма түскенін анықтау */
export function duplicateTasks(db: Db, tenantIds: ID[]): { key: string; tasks: Task[] }[] {
  const open = db.tasks.filter((t) => tenantIds.includes(t.tenantId) && !['done', 'cancelled'].includes(t.status));
  const map = new Map<string, Task[]>();
  for (const t of open) {
    const key = t.findingId ? `F:${t.findingId}` : t.docIds.length ? `D:${t.tenantId}:${t.opType}:${[...t.docIds].sort().join(',')}` : `T:${t.tenantId}:${t.title.toLowerCase()}`;
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return [...map.entries()].filter(([, v]) => v.length > 1).map(([key, tasks]) => ({ key, tasks }));
}

export function findOpenDuplicate(db: Db, candidate: { tenantId: ID; findingId: ID | null; opType: string; docIds: ID[] }): Task | null {
  return (
    db.tasks.find(
      (t) =>
        t.tenantId === candidate.tenantId &&
        !['done', 'cancelled'].includes(t.status) &&
        ((candidate.findingId && t.findingId === candidate.findingId) ||
          (candidate.docIds.length > 0 && t.opType === candidate.opType && [...t.docIds].sort().join(',') === [...candidate.docIds].sort().join(','))),
    ) ?? null
  );
}
