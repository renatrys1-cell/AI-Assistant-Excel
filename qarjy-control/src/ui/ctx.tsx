import { createContext, useContext } from 'react';
import type { Api } from '../server/api';
import type { Db, ID, Role } from '../domain/types';
import type { Session } from '../server/store';
import type { Money } from '../domain/money';

export interface DrillSpec {
  title: string;
  tenantId: ID;
  formula?: string;
  explainKey?: string;
  lines?: { label: string; value: Money | null; strong?: boolean; note?: string }[];
  txIds?: ID[];
  notes?: string[];
  meta?: { period: string; source: string; updated: string; status?: string };
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export interface AppCtx {
  db: Db;
  api: Api;
  session: Session;
  setSession: (p: Partial<Session>) => void;
  refresh: () => void;
  toast: (msg: string, err?: boolean) => void;
  go: (path: string) => void;
  route: Route;
  openDrill: (d: DrillSpec) => void;
  openDoc: (tenantId: ID, docId: ID) => void;
  openFinding: (id: ID) => void;
  openTask: (id: ID) => void;
  /** Әрекетті орындайды; қате болса toast көрсетіп undefined қайтарады, сәтті болса мәнді (немесе true) қайтарады */
  run: <T>(fn: () => T, okMsg?: string) => NonNullable<T> | true | undefined;
  version: number;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

const ROLE_PRIORITY: Role[] = ['platform_admin', 'service_lead', 'chief_accountant', 'accountant', 'integrator', 'owner', 'client_manager'];
export function primaryRole(roles: Role[]): Role | null {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
}
