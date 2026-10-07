/**
 * Мәселе (Finding) және тапсырма (Task) мәртебелерінің ауысу ережелері.
 * Таза функциялар: рұқсат етілмеген ауысу WorkflowError лақтырады.
 */
import type { Finding, FindingStatus, Role, Task, TaskStatus } from './types';

export class WorkflowError extends Error {}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  new: 'Жаңа',
  in_review: 'Тексерілуде',
  waiting_client: 'Клиент жауабын күтуде',
  fix_proposed: 'Түзету ұсынылды',
  approved: 'Бекітілді',
  rechecked: 'Қайта тексерілді',
  closed: 'Жабылды',
  not_an_error: 'Қате емес',
};

export const FINDING_FLOW: FindingStatus[] = ['new', 'in_review', 'waiting_client', 'fix_proposed', 'approved', 'rechecked', 'closed'];

const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  new: ['in_review', 'not_an_error'],
  in_review: ['waiting_client', 'fix_proposed', 'not_an_error'],
  waiting_client: ['in_review', 'fix_proposed'],
  fix_proposed: ['approved', 'in_review'],
  approved: ['rechecked', 'in_review'],
  rechecked: ['closed', 'in_review'],
  closed: [],
  not_an_error: ['in_review'],
};

/** Кім қандай мәртебеге ауыстыра алады */
const FINDING_ROLE: Partial<Record<FindingStatus, Role[]>> = {
  in_review: ['accountant', 'chief_accountant'],
  waiting_client: ['accountant', 'chief_accountant'],
  fix_proposed: ['accountant', 'chief_accountant'],
  approved: ['chief_accountant'],
  rechecked: ['accountant', 'chief_accountant'],
  closed: ['chief_accountant'],
  not_an_error: ['accountant', 'chief_accountant'],
};

export function allowedFindingTransitions(f: Finding, roles: Role[]): FindingStatus[] {
  return FINDING_TRANSITIONS[f.status].filter((to) => (FINDING_ROLE[to] ?? []).some((r) => roles.includes(r)));
}

export interface FindingTransitionInput {
  to: FindingStatus;
  by: string;
  roles: Role[];
  at: string;
  note?: string;
  reason?: string; // not_an_error үшін
  fixEvidence?: string; // fix_proposed үшін
  confirmedImpact?: number | null;
}

export function transitionFinding(f: Finding, input: FindingTransitionInput): Finding {
  const { to } = input;
  if (!FINDING_TRANSITIONS[f.status].includes(to)) {
    throw new WorkflowError(`«${FINDING_STATUS_LABEL[f.status]}» → «${FINDING_STATUS_LABEL[to]}» ауысуы рұқсат етілмеген`);
  }
  const allowedRoles = FINDING_ROLE[to] ?? [];
  if (!allowedRoles.some((r) => input.roles.includes(r))) {
    throw new WorkflowError(`Бұл әрекетке рұқсат жоқ: «${FINDING_STATUS_LABEL[to]}» мәртебесін тек ${allowedRoles.join(', ')} қоя алады`);
  }
  const next: Finding = { ...f, history: [...f.history] };
  if (to === 'not_an_error') {
    if (!input.reason || input.reason.trim().length < 10) throw new WorkflowError('«Қате емес» үшін негіздеме міндетті (кемінде 10 таңба)');
    next.notAnErrorReason = input.reason.trim();
    next.confirmedImpact = 0;
  }
  if (to === 'fix_proposed') {
    const ev = input.fixEvidence ?? f.fixEvidence;
    if (!ev || ev.trim().length < 5) throw new WorkflowError('Түзету ұсынысы үшін дәлел керек');
    next.fixEvidence = ev.trim();
  }
  if (to === 'rechecked') {
    if (!f.recheck || !f.recheck.passed) throw new WorkflowError('Қайта тексеру нәтижесі жоқ немесе сәтсіз. Алдымен «Қайта тексеру» іске қосылсын.');
  }
  if (to === 'closed') {
    if (f.status !== 'rechecked' || !f.recheck?.passed) throw new WorkflowError('Мәселені тек сәтті қайта тексеруден кейін жабуға болады');
    if (!f.fixEvidence) throw new WorkflowError('Түзету дәлелі жоқ — жабуға болмайды');
  }
  if (to === 'in_review' && (f.status === 'approved' || f.status === 'rechecked')) {
    next.recheck = undefined;
  }
  if (input.confirmedImpact !== undefined) next.confirmedImpact = input.confirmedImpact;
  next.status = to;
  next.history.push({ at: input.at, by: input.by, from: f.status, to, note: input.note ?? input.reason ?? input.fixEvidence });
  return next;
}

// ───────── Тапсырмалар ─────────

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Орындалуы керек',
  in_progress: 'Орындалуда',
  waiting_client: 'Клиент жауабын күтуде',
  in_review: 'Тексеруде',
  returned: 'Кері қайтарылды',
  done: 'Қабылданды',
  cancelled: 'Тоқтатылды',
};

export const KANBAN_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'waiting_client', 'returned', 'in_review', 'done'];

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['waiting_client', 'in_review', 'cancelled'],
  waiting_client: ['in_progress'],
  returned: ['in_progress'],
  in_review: ['done', 'returned'],
  done: [],
  cancelled: [],
};

export function allowedTaskTransitions(t: Task, userId: string, roles: Role[]): TaskStatus[] {
  return TASK_TRANSITIONS[t.status].filter((to) => {
    if (to === 'done' || to === 'returned') return canReview(t, userId, roles);
    if (to === 'cancelled') return roles.includes('chief_accountant') || roles.includes('service_lead');
    return t.assigneeId === userId || roles.includes('chief_accountant');
  });
}

export function canReview(t: Task, userId: string, roles: Role[]): boolean {
  // Төрт көз қағидасы: орындаушы өз жұмысын өзі қабылдай алмайды
  if (t.assigneeId === userId) return false;
  return t.reviewerId === userId || roles.includes('chief_accountant');
}

export interface TaskTransitionInput {
  to: TaskStatus;
  by: string;
  roles: Role[];
  at: string;
  note?: string;
}

export function transitionTask(t: Task, input: TaskTransitionInput): Task {
  const { to } = input;
  if (!TASK_TRANSITIONS[t.status].includes(to)) {
    throw new WorkflowError(`«${TASK_STATUS_LABEL[t.status]}» → «${TASK_STATUS_LABEL[to]}» ауысуы рұқсат етілмеген`);
  }
  if (!allowedTaskTransitions(t, input.by, input.roles).includes(to)) {
    throw new WorkflowError(to === 'done' || to === 'returned' ? 'Тексеруге рұқсат жоқ (орындаушы өз жұмысын қабылдай алмайды)' : 'Бұл тапсырманы тек орындаушы немесе бас бухгалтер өзгерте алады');
  }
  const next: Task = { ...t };
  if (to === 'waiting_client') {
    if (!input.note || input.note.trim().length < 5) throw new WorkflowError('Күту себебін көрсетіңіз');
    next.waitReason = input.note.trim();
  }
  if (to === 'in_progress') {
    if (!t.startedAt) next.startedAt = input.at;
    if (t.status === 'waiting_client') next.waitReason = null;
  }
  if (to === 'in_review') {
    if (!t.evidence.length) throw new WorkflowError('Тексеруге жіберу үшін нәтиже дәлелін қосыңыз');
  }
  if (to === 'returned') {
    if (!input.note || input.note.trim().length < 5) throw new WorkflowError('Кері қайтару себебін жазыңыз');
    next.returnCount = t.returnCount + 1;
    next.reviewResult = { decision: 'returned', by: input.by, at: input.at, note: input.note.trim() };
  }
  if (to === 'done') {
    next.finishedAt = input.at;
    next.reviewResult = { decision: 'accepted', by: input.by, at: input.at, note: input.note?.trim() ?? '' };
  }
  next.status = to;
  return next;
}

/** Тапсырма мәртебесіне сәйкес мәселе мәртебесі */
export function findingStatusForTask(task: TaskStatus): FindingStatus | null {
  switch (task) {
    case 'in_progress':
      return 'in_review';
    case 'waiting_client':
      return 'waiting_client';
    case 'in_review':
      return 'fix_proposed';
    case 'returned':
      return 'in_review';
    case 'done':
      return 'approved';
    default:
      return null;
  }
}
