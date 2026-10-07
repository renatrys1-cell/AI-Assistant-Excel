import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ctx, primaryRole, type AppCtx, type DrillSpec, type Route } from './ctx';
import { Api, ForbiddenError } from '../server/api';
import { loadDb, loadSession, resetDb, saveDb, saveSession, type Session } from '../server/store';
import type { Db, ID, Role } from '../domain/types';
import { availablePeriods, fmtDateTime } from '../domain/periods';
import { t, type TKey } from './i18n';
import { Badge, Forbidden } from './components/ui';
import { DocModal, DrillModal, FindingModal, TaskModal } from './components/detail';
import { ROLE_LABEL } from '../server/authz';
import { LoginPage } from './pages/Login';
import { OwnerHome } from './pages/OwnerHome';
import { FinancePage } from './pages/Finance';
import { FindingsPage } from './pages/Findings';
import { TasksPage } from './pages/Tasks';
import { DocumentsPage } from './pages/Documents';
import { TeamPage } from './pages/Team';
import { ControlPage } from './pages/Control';
import { ReportsPage } from './pages/Reports';
import { AiPage } from './pages/Ai';
import { ServicePage } from './pages/Service';
import { ClientCardPage } from './pages/ClientCard';
import { OnboardingPage } from './pages/Onboarding';
import { IntegrationsPage } from './pages/Integrations';
import { SettingsPage } from './pages/Settings';
import { WorkPage } from './pages/Work';
import { OPEN_FINDING_STATUSES } from '../domain/checks';


type NavKey = TKey;
const NAV: Record<Role, [NavKey, string, string][]> = {
  owner: [['home', '/home', '◎'], ['finance', '/finance', '₸'], ['issues', '/issues', '⚑'], ['tasks', '/tasks', '☑'], ['docs', '/docs', '▤'], ['reports', '/reports', '▦'], ['ai', '/ai', '✦'], ['service', '/service', '◈'], ['settings', '/settings', '⚙']],
  client_manager: [['tasks', '/tasks', '☑'], ['docs', '/docs', '▤'], ['settings', '/settings', '⚙']],
  accountant: [['work', '/work', '◎'], ['tasks', '/tasks', '☑'], ['issues', '/issues', '⚑'], ['finance', '/finance', '₸'], ['docs', '/docs', '▤'], ['team', '/team', '◉'], ['reports', '/reports', '▦'], ['ai', '/ai', '✦'], ['integrations', '/integrations', '⇄'], ['settings', '/settings', '⚙']],
  chief_accountant: [['control', '/control', '◎'], ['tasks', '/tasks', '☑'], ['issues', '/issues', '⚑'], ['finance', '/finance', '₸'], ['docs', '/docs', '▤'], ['team', '/team', '◉'], ['reports', '/reports', '▦'], ['ai', '/ai', '✦'], ['integrations', '/integrations', '⇄'], ['settings', '/settings', '⚙']],
  service_lead: [['team', '/team', '◉'], ['service', '/service', '◈'], ['control', '/control', '◎'], ['home', '/home', '▣'], ['tasks', '/tasks', '☑'], ['issues', '/issues', '⚑'], ['finance', '/finance', '₸'], ['reports', '/reports', '▦'], ['ai', '/ai', '✦'], ['integrations', '/integrations', '⇄'], ['settings', '/settings', '⚙']],
  integrator: [['integrations', '/integrations', '⇄'], ['settings', '/settings', '⚙']],
  platform_admin: [['settings', '/settings', '⚙']],
};
const DEFAULT_PATH: Record<Role, string> = { owner: '/home', client_manager: '/tasks', accountant: '/work', chief_accountant: '/control', service_lead: '/team', integrator: '/integrations', platform_admin: '/settings' };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

export function App() {
  const [db, setDb] = useState<Db>(() => loadDb());
  const [session, setSess] = useState<Session>(() => loadSession());
  const [version, setVersion] = useState(0);
  const [route, setRoute] = useState<Route>(parseHash);
  const [toastMsg, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [drill, setDrill] = useState<DrillSpec | null>(null);
  const [doc, setDoc] = useState<{ tenantId: ID; docId: ID } | null>(null);
  const [findingId, setFindingId] = useState<ID | null>(null);
  const [taskId, setTaskId] = useState<ID | null>(null);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const setSession = useCallback((p: Partial<Session>) => {
    setSess((s) => {
      const n = { ...s, ...p };
      saveSession(n);
      return n;
    });
  }, []);

  const persist = useCallback(() => {
    saveDb(db);
    setVersion((v) => v + 1);
  }, [db]);

  const api = useMemo(() => new Api(db, session.userId ?? '__anon__', persist), [db, session.userId, persist]);

  const toast = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    window.setTimeout(() => setToast((x) => (x && x.msg === msg ? null : x)), err ? 5200 : 2800);
  }, []);

  const go = useCallback((path: string) => {
    window.location.hash = path;
  }, []);

  const run: AppCtx['run'] = useCallback(
    (fn, okMsg) => {
      try {
        const r = fn();
        if (okMsg) toast(okMsg);
        setVersion((v) => v + 1);
        return (r ?? true) as never;
      } catch (e) {
        toast((e as Error).message, true);
        setVersion((v) => v + 1);
        return undefined;
      }
    },
    [toast],
  );

  const [forbidden, setForbidden] = useState<string | null>(null);
  const qTenant = route.query.get('tenant');
  useEffect(() => {
    if (!session.userId || !qTenant) {
      setForbidden(null);
      return;
    }
    try {
      api.tenant(qTenant);
      setForbidden(null);
      setSession({ tenantId: qTenant, branchId: null });
    } catch (e) {
      setForbidden(e instanceof ForbiddenError ? `${e.message}. Сұралған компания: ${qTenant}.` : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qTenant, session.userId]);

  const ctx: AppCtx = {
    db, api, session, setSession, refresh: () => setVersion((v) => v + 1), toast, go, route, version, run,
    openDrill: setDrill, openDoc: (tenantId, docId) => setDoc({ tenantId, docId }),
    openFinding: (id) => { setTaskId(null); setFindingId(id); },
    openTask: (id) => { setFindingId(null); setTaskId(id); },
  };

  // ── Кіру (demo: рөл таңдау) ──
  if (!session.userId || !db.users.some((u) => u.id === session.userId)) {
    return (
      <Ctx.Provider value={ctx}>
        <LoginPage
          onLogin={(userId) => {
            const a = new Api(db, userId, persist);
            const tenants = a.tenants();
            const role = primaryRole(a.allRoles());
            setSession({ userId, tenantId: tenants[0]?.id ?? null, branchId: null });
            db.audit.push({ id: `au_login_${db.seq++}`, at: a.now(), userId, role, tenantId: null, action: 'login', entity: 'User', entityId: userId, result: 'ok', details: 'Demo кіру (рөл таңдау)' });
            saveDb(db);
            go(role ? DEFAULT_PATH[role] : '/settings');
          }}
          onReset={() => {
            setDb(resetDb());
            toast('Demo деректер бастапқы күйге қайтарылды');
          }}
        />
        {toastMsg && <div className={`toast ${toastMsg.err ? 'err' : ''}`}>{toastMsg.msg}</div>}
      </Ctx.Provider>
    );
  }

  const user = api.me();
  const roles = api.allRoles();
  const role = primaryRole(roles) ?? 'platform_admin';
  const tenants = api.tenants();
  const tenantId = session.tenantId && tenants.some((x) => x.id === session.tenantId) ? session.tenantId : tenants[0]?.id ?? null;
  if (tenantId !== session.tenantId) setTimeout(() => setSession({ tenantId, branchId: null }), 0);
  const branches = tenantId ? db.branches.filter((b) => b.tenantId === tenantId) : [];
  const nav = NAV[role];
  const lang = session.lang;
  const path = '/' + (route.parts[0] ?? '');
  const fresh = tenantId ? api.connections().find((c) => c.tenant.id === tenantId)?.freshness : null;
  const openFindings = tenantId && api.can('findings.read', tenantId) ? api.findings(tenantId).filter((f) => (OPEN_FINDING_STATUSES as readonly string[]).includes(f.status)) : [];
  const counts: Partial<Record<NavKey, number>> = {
    issues: openFindings.length,
    tasks: api.tasks().filter((x) => (x.assigneeId === api.userId || x.clientAssigneeId === api.userId) && !['done', 'cancelled'].includes(x.status)).length || undefined,
  };

  let page: ReactNode;
  const needTenant = (n: (tid: ID) => ReactNode) => (tenantId ? n(tenantId) : <Forbidden message="Сізге бірде-бір компания бекітілмеген." />);
  if (forbidden) page = <Forbidden message={forbidden} />;
  else {
    switch (path) {
      case '/home': page = needTenant((tid) => <OwnerHome tenantId={tid} />); break;
      case '/work': page = <WorkPage />; break;
      case '/finance': page = needTenant((tid) => <FinancePage tenantId={tid} />); break;
      case '/issues': page = <FindingsPage tenantId={tenantId} />; break;
      case '/tasks': page = <TasksPage tenantId={tenantId} />; break;
      case '/docs': page = needTenant((tid) => <DocumentsPage tenantId={tid} />); break;
      case '/team': page = <TeamPage />; break;
      case '/control': page = <ControlPage />; break;
      case '/reports': page = needTenant((tid) => <ReportsPage tenantId={tid} />); break;
      case '/ai': page = needTenant((tid) => <AiPage tenantId={tid} />); break;
      case '/service': page = <ServicePage />; break;
      case '/client': page = <ClientCardPage tenantId={route.parts[1] ?? tenantId ?? ''} />; break;
      case '/onboarding': page = <OnboardingPage />; break;
      case '/integrations': page = <IntegrationsPage />; break;
      case '/settings': page = <SettingsPage />; break;
      default:
        setTimeout(() => go(DEFAULT_PATH[role]), 0);
        page = null;
    }
  }
  const showFilters = ['/home', '/finance', '/issues', '/docs', '/reports', '/ai', '/tasks'].includes(path);
  const showPeriod = ['/home', '/finance', '/team', '/service'].includes(path);
  const tenantObj = tenants.find((x) => x.id === tenantId);
  const finalReport = tenantId ? (() => {
    try {
      const p = availablePeriods().find((x) => x.key === session.periodKey)!;
      const months = new Set([p.from.slice(0, 7), p.to.slice(0, 7)]);
      return [...months].every((m) => db.periodCloses.some((c) => c.tenantId === tenantId && c.period === m && c.status === 'closed'));
    } catch {
      return false;
    }
  })() : false;

  const navEl = (cls: string) =>
    nav.map(([k, p, icon]) => (
      <a key={p} className={`nav-item ${path === p ? 'active' : ''} ${cls}`} href={`#${p}`}>
        <span style={{ width: 16, textAlign: 'center' }}>{icon}</span> {t(lang, k)}
        {counts[k] ? <span className="count">{counts[k]}</span> : null}
      </a>
    ));

  return (
    <Ctx.Provider value={ctx}>
      <div className={`shell ${session.density === 'compact' ? 'compact' : ''}`}>
        <aside className="side">
          <div className="brand">
            <span className="brand-mark">Q</span>
            <span>{db.settings.platformName}</span>
          </div>
          {navEl('')}
          <div className="side-foot">
            <div style={{ color: '#fff' }}>{user.name}</div>
            <div>{roles.map((r) => ROLE_LABEL[r]).join(', ')}</div>
            <button className="btn sm mt8" style={{ background: 'transparent', color: '#c9d6e2', borderColor: 'rgba(255,255,255,.2)' }} onClick={() => setSession({ userId: null })}>
              ⇆ {t(lang, 'logout')}
            </button>
          </div>
        </aside>
        <div className="main">
          <nav className="mobile-nav">{navEl('')}</nav>
          <div className="demo-strip">{t(lang, 'demoStrip')}</div>
          <header className="topbar">
            {tenants.length > 0 && (
              <label className="row small" title={t(lang, 'company')}>
                <select value={tenantId ?? ''} onChange={(e) => setSession({ tenantId: e.target.value, branchId: null })} aria-label={t(lang, 'company')}>
                  {tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showFilters && branches.length > 1 && (
              <select value={session.branchId ?? ''} onChange={(e) => setSession({ branchId: e.target.value || null })} aria-label={t(lang, 'branch')}>
                <option value="">{t(lang, 'allBranches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {showPeriod && (
              <select value={session.periodKey} onChange={(e) => setSession({ periodKey: e.target.value })} aria-label={t(lang, 'period')}>
                {availablePeriods().map((p) => <option key={p.key} value={p.key}>{lang === 'ru' ? p.labelRu : p.label}</option>)}
              </select>
            )}
            {tenantObj && fresh && (
              <span className="row small" style={{ gap: 6 }}>
                <span className="muted">{t(lang, 'lastSync')}:</span>
                <span className="num">{fresh.lastSuccessAt ? fmtDateTime(fresh.lastSuccessAt) : '—'}</span>
                {fresh.status === 'stale' ? <Badge tone="warn">{t(lang, 'dataStale')} · {fresh.hours} сағ</Badge> : fresh.status === 'fresh' ? <Badge tone="ok">{t(lang, 'dataOk')}</Badge> : <Badge>Қосылмаған</Badge>}
              </span>
            )}
            {tenantObj && showPeriod && path !== '/team' && path !== '/service' && <Badge tone={finalReport ? 'ok' : 'info'}>{finalReport ? t(lang, 'final') : t(lang, 'preliminary')}</Badge>}
            {tenantObj && openFindings.length > 0 && (
              <a className="small" href="#/issues" title="Дерек сапасы: ашық тексеру мәселелері">
                Дерек сапасы: <b>{openFindings.length}</b> ашық мәселе{openFindings.filter((f) => f.severity === 'high' || f.severity === 'critical').length ? `, ${openFindings.filter((f) => f.severity === 'high' || f.severity === 'critical').length} жоғары` : ''}
              </a>
            )}
            <span className="grow" />
            <div className="seg" aria-label="Тіл">
              <button className={lang === 'kk' ? 'on' : ''} onClick={() => setSession({ lang: 'kk' })}>ҚАЗ</button>
              <button className={lang === 'ru' ? 'on' : ''} onClick={() => setSession({ lang: 'ru' })}>РУС</button>
            </div>
          </header>
          <main className="content" key={tenantId ?? 'none'}>{page}</main>
        </div>
      </div>
      {findingId && <FindingModal id={findingId} onClose={() => setFindingId(null)} />}
      {taskId && <TaskModal id={taskId} onClose={() => setTaskId(null)} />}
      {drill && <DrillModal d={drill} onClose={() => setDrill(null)} />}
      {doc && <DocModal tenantId={doc.tenantId} docId={doc.docId} onClose={() => setDoc(null)} />}
      {toastMsg && <div className={`toast ${toastMsg.err ? 'err' : ''}`} role="status">{toastMsg.msg}</div>}
    </Ctx.Provider>
  );
}
