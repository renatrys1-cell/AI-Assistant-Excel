/**
 * Рұқсаттар моделі. Бұл модуль «backend» қабатына жатады: UI тек API арқылы деректі алады,
 * ал API әр сұрауда осы функциялармен tenant пен рұқсатты тексереді.
 * DEMO ЕСКЕРТУ: прототипте бұл код браузерде орындалады. Production-да дәл осы тексерулер серверде болуы тиіс.
 */
import type { Db, ID, Role } from '../domain/types';

export type Perm =
  | 'finance.read'
  | 'findings.read'
  | 'findings.work'
  | 'findings.approve'
  | 'tasks.read'
  | 'tasks.read_all'
  | 'tasks.work'
  | 'tasks.review'
  | 'tasks.assign'
  | 'tasks.create_from_issue'
  | 'decisions.approve'
  | 'docs.read'
  | 'docs.upload'
  | 'team.read'
  | 'kpi.config'
  | 'close.manage'
  | 'service.view'
  | 'service.economics'
  | 'integration.read'
  | 'integration.manage'
  | 'ai.ask'
  | 'audit.read'
  | 'onboarding'
  | 'admin.users'
  | 'settings.platform';

export const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: ['finance.read', 'findings.read', 'tasks.read', 'tasks.create_from_issue', 'decisions.approve', 'docs.read', 'docs.upload', 'service.view', 'ai.ask', 'audit.read'],
  client_manager: ['docs.read', 'docs.upload', 'tasks.read', 'tasks.work'],
  accountant: ['finance.read', 'findings.read', 'findings.work', 'tasks.read', 'tasks.work', 'tasks.create_from_issue', 'docs.read', 'docs.upload', 'ai.ask', 'team.read'],
  chief_accountant: ['finance.read', 'findings.read', 'findings.work', 'findings.approve', 'tasks.read', 'tasks.read_all', 'tasks.work', 'tasks.review', 'tasks.assign', 'tasks.create_from_issue', 'docs.read', 'docs.upload', 'team.read', 'close.manage', 'ai.ask', 'audit.read'],
  service_lead: ['finance.read', 'findings.read', 'tasks.read', 'tasks.read_all', 'tasks.assign', 'tasks.create_from_issue', 'docs.read', 'team.read', 'kpi.config', 'service.view', 'service.economics', 'integration.read', 'onboarding', 'ai.ask', 'audit.read'],
  integrator: ['integration.read', 'integration.manage'],
  platform_admin: ['admin.users', 'settings.platform', 'audit.read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Кәсіп иесі',
  client_manager: 'Клиент менеджері',
  accountant: 'Бухгалтер',
  chief_accountant: 'Бас бухгалтер',
  service_lead: 'Қызмет жетекшісі',
  integrator: 'Интегратор',
  platform_admin: 'Платформа әкімшісі',
};

export class ForbiddenError extends Error {
  constructor(message = 'Рұқсат жоқ') {
    super(message);
  }
}

export function activeMemberships(db: Db, userId: ID, nowIso: string) {
  return db.memberships.filter((m) => m.userId === userId && !m.revokedAt && (!m.expiresAt || m.expiresAt > nowIso));
}

export function rolesIn(db: Db, userId: ID, tenantId: ID | null, nowIso: string): Role[] {
  return activeMemberships(db, userId, nowIso)
    .filter((m) => m.tenantId === tenantId)
    .map((m) => m.role);
}

export function allRoles(db: Db, userId: ID, nowIso: string): Role[] {
  return [...new Set(activeMemberships(db, userId, nowIso).map((m) => m.role))];
}

export function accessibleTenantIds(db: Db, userId: ID, nowIso: string): ID[] {
  return [...new Set(activeMemberships(db, userId, nowIso).map((m) => m.tenantId).filter((t): t is ID => t !== null))];
}

/** Бір tenant ішіндегі рұқсат. Интегратор мен менеджерге қаржылық рұқсат тек financeAccess = true болса. */
export function can(db: Db, userId: ID, perm: Perm, tenantId: ID | null, nowIso: string): boolean {
  const ms = activeMemberships(db, userId, nowIso).filter((m) => m.tenantId === tenantId);
  for (const m of ms) {
    if (ROLE_PERMS[m.role].includes(perm)) return true;
    if (perm === 'finance.read' && (m.role === 'integrator' || m.role === 'client_manager') && m.financeAccess) return true;
  }
  return false;
}

/** Платформа деңгейіндегі немесе кез келген tenant-тағы рұқсат */
export function canAnywhere(db: Db, userId: ID, perm: Perm, nowIso: string): boolean {
  return activeMemberships(db, userId, nowIso).some((m) => ROLE_PERMS[m.role].includes(perm));
}
