import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, NotImplemented, Tabs } from '../components/ui';
import { ROLE_LABEL } from '../../server/authz';
import { fmtDateTime } from '../../domain/periods';
import { resetDb, isPersistent } from '../../server/store';
import type { Role } from '../../domain/types';

export const PRODUCTION_CHECKLIST: { area: string; items: string[] }[] = [
  { area: 'Заң және реттеу (жергілікті мамандар тексереді)', items: ['Дербес деректерді сақтау және өңдеу талаптары (сақтау орны, келісім, трансшекаралық беру)', 'Бухгалтерлік аутсорсинг қызметіне қойылатын талаптар және шарт үлгісі', 'Бастапқы құжаттар мен есептерді сақтау мерзімдері', 'Есеп тапсыру мерзімдері мен салық ставкалары — платформа оларды ойдан шығармайды; кесте маманмен расталғаннан кейін ғана енгізіледі', 'Электрондық құжат айналымы және ЭСФ-пен жұмыс талаптары', 'AI провайдеріне дерек беру (сервер орналасқан ел, келісім)'] },
  { area: 'Қауіпсіздік', items: ['Нақты аутентификация (SSO/пароль) + міндетті MFA рөлдер үшін', 'Рұқсатты тек серверде тексеру (қазір demo-да браузерде)', 'Tenant оқшаулауы дерекқор деңгейінде (row-level security)', 'Құпия кілттер — тек серверде, secrets manager', 'TLS, деректерді сақтаудағы шифрлау', 'Резервтік көшірме және қалпына келтіру жаттығуы', 'Қолжетімділікті қайтарып алу процесі және мерзімді шолу', 'Аудит журналының өзгермейтіндігі (append-only)', 'Сақтау және жою саясаты, клиент кеткенде дерек экспорты'] },
  { area: 'AI', items: ['Сұраққа қажетті ең аз агрегат жіберу', 'Құжат мәтінін нұсқау ретінде қабылдамау (prompt injection қорғанысы)', 'AI жауабы мен есептеу қабатының нәтижесін салыстыратын тесттер'] },
];

export function SettingsPage() {
  const { api, run, session, setSession, go } = useApp();
  const [tab, setTab] = useState<'general' | 'security' | 'users' | 'audit' | 'prod'>('general');
  const [name, setName] = useState(api.db.settings.platformName);
  const [grant, setGrant] = useState({ userId: '', tenantId: '', role: 'accountant' as Role, hours: '8', reason: '' });
  const isAdmin = api.canAnywhere('admin.users');
  const me = api.me();
  const tenantForAudit = session.tenantId && api.can('audit.read', session.tenantId) ? session.tenantId : null;
  const audit = (() => {
    try {
      return api.auditLog(isAdmin ? null : tenantForAudit).slice().reverse().slice(0, 200);
    } catch {
      return [];
    }
  })();
  const otherTenant = api.db.tenants.find((t) => !api.tenants().some((x) => x.id === t.id));
  const admin = isAdmin ? api.adminUsers() : null;

  return (
    <div className="col gap16">
      <div className="row between">
        <h1>Баптаулар</h1>
        <Tabs value={tab} onChange={setTab} items={[['general', 'Жалпы'], ['security', 'Қауіпсіздік'], ...(isAdmin ? ([['users', 'Пайдаланушылар']] as [typeof tab, string][]) : []), ['audit', 'Аудит журналы'], ['prod', 'Production алдында']]} />
      </div>
      {tab === 'general' && (
        <div className="grid g2">
          <Card title="Платформа атауы" sub="Жұмыс атауы — уақытша">
            <div className="row">
              <input className="grow" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary" onClick={() => run(() => api.setPlatformName(name), 'Атау өзгертілді')}>Сақтау</button>
            </div>
            <div className="small muted mt8">Атауды платформа әкімшісі немесе қызмет жетекшісі өзгертеді.</div>
          </Card>
          <Card title="Интерфейс">
            <div className="row">
              Тіл: <Tabs value={session.lang} onChange={(l) => setSession({ lang: l })} items={[['kk', 'Қазақша'], ['ru', 'Русский']]} />
            </div>
            <div className="row mt8">
              Кесте тығыздығы: <Tabs value={session.density} onChange={(d) => setSession({ density: d })} items={[['comfortable', 'Кең'], ['compact', 'Тығыз']]} />
            </div>
            <div className="small muted mt8">Валюта: теңге (₸). Уақыт белдеуі: Asia/Almaty. Орыс тілі — интерфейс элементтері мен AI жауаптары үшін; demo деректер мазмұны қазақша.</div>
          </Card>
          <Card title="Demo деректер">
            <div className="small">Сақтау: {isPersistent() ? 'браузердің localStorage (бет жаңартылғанда сақталады)' : 'жадта ғана (localStorage қолжетімсіз)'}. Бұл production қауіпсіздігі емес.</div>
            <button className="btn danger mt8" onClick={() => { if (confirm('Барлық demo өзгерістер өшіріледі.')) { resetDb(); window.location.reload(); } }}>Бастапқы күйге қайтару</button>
          </Card>
        </div>
      )}
      {tab === 'security' && (
        <div className="grid g2">
          <Card title="Менің аккаунтым">
            <div className="row">MFA: {me.mfaEnabled ? <Badge tone="ok">қосулы</Badge> : <Badge tone="warn">өшірулі</Badge>} <button className="btn sm" onClick={() => run(() => api.toggleMfa(me.id), 'Өзгертілді')}>{me.mfaEnabled ? 'Өшіру' : 'Қосу'}</button> <NotImplemented>нақты MFA — production</NotImplemented></div>
            <div className="small mt8">Рөлдерім: {api.memberships().map((m) => `${ROLE_LABEL[m.role]}${m.tenantId ? ` · ${api.db.tenants.find((t) => t.id === m.tenantId)?.name}` : ' · платформа'}${m.expiresAt ? ` (мерзімі ${fmtDateTime(m.expiresAt)})` : ''}`).join('; ')}</div>
          </Card>
          <Card title="Клиенттерді оқшаулау тексеруі" sub="Сценарий 11">
            {otherTenant ? (
              <>
                <div className="small">Сізге бекітілмеген компания: <b>{otherTenant.name}</b>. Оның бетін URL арқылы ашып көріңіз — API рұқсат бермейді және әрекет аудитке жазылады.</div>
                <button className="btn mt8" onClick={() => go(`/home?tenant=${otherTenant.id}`)}>Басқа компанияның бетін ашу әрекеті →</button>
              </>
            ) : <div className="small muted">Сізде барлық компанияға рұқсат бар.</div>}
          </Card>
          <Card title="Қорғаныс шаралары" className="span2">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Әр сұрауда tenant пен рөл API қабатында тексеріледі (src/server/authz.ts). <Badge tone="warn">demo: браузерде</Badge></li>
              <li>Платформа әкімшісі клиент деректерін әдепкі түрде ашпайды; уақытша рұқсат себебімен беріледі және аудитке жазылады.</li>
              <li>Интегратор мен клиент менеджеріне қаржылық ақпарат бөлек рұқсатпен.</li>
              <li>AI-ға сұраққа қажетті ең аз агрегат жіберіледі; құжат мәтіні нұсқау ретінде қабылданбайды.</li>
              <li>Құпия кілттер frontend кодында жоқ (demo-да нақты кілт мүлдем қолданылмайды).</li>
              <li>Деректерді экспорттау (Есептер → JSON) — тек кәсіп иесі немесе қызмет жетекшісі.</li>
            </ul>
          </Card>
        </div>
      )}
      {tab === 'users' && admin && (
        <div className="col gap16">
          <Card title="Уақытша қолжетімділік беру" sub="Себебі міндетті, аудитке жазылады">
            <div className="row">
              <select value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })}><option value="">Пайдаланушы</option>{admin.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              <select value={grant.tenantId} onChange={(e) => setGrant({ ...grant, tenantId: e.target.value })}><option value="">Компания</option>{admin.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'platform_admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <input style={{ width: 80 }} value={grant.hours} onChange={(e) => setGrant({ ...grant, hours: e.target.value })} title="Сағат (бос — мерзімсіз)" />сағ
              <input className="grow" placeholder="Себебі" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} />
              <button className="btn primary" disabled={!grant.userId || !grant.tenantId} onClick={() => run(() => api.grantAccess(grant.userId, grant.tenantId, grant.role, grant.hours ? parseInt(grant.hours, 10) : null, grant.reason), 'Рұқсат берілді')}>Беру</button>
            </div>
          </Card>
          <Card title="Пайдаланушылар мен рөлдер" sub="Әкімші клиенттердің қаржылық деректерін көрмейді">
            <div className="tbl-wrap">
              <table className="tbl small">
                <thead><tr><th>Пайдаланушы</th><th>Рөл</th><th>Компания</th><th>Қаржыға рұқсат</th><th>Мерзімі</th><th>MFA</th><th></th></tr></thead>
                <tbody>
                  {admin.memberships.map((m) => {
                    const u = admin.users.find((x) => x.id === m.userId)!;
                    return (
                      <tr key={m.id} style={m.revokedAt ? { opacity: 0.45 } : undefined}>
                        <td>{u.name}<div className="muted tiny">{u.email}</div></td>
                        <td>{ROLE_LABEL[m.role]}</td>
                        <td>{admin.tenants.find((t) => t.id === m.tenantId)?.name ?? 'Платформа'}</td>
                        <td>{m.role === 'integrator' || m.role === 'client_manager' ? <label className="row"><input type="checkbox" checked={!!m.financeAccess} disabled={!!m.revokedAt} onChange={() => run(() => api.toggleFinanceAccess(m.id))} /> {m.financeAccess ? 'бар' : 'жоқ'}</label> : <span className="muted">рөл бойынша</span>}</td>
                        <td className="small">{m.revokedAt ? `қайтарылды ${fmtDateTime(m.revokedAt)}` : m.expiresAt ? fmtDateTime(m.expiresAt) : '—'}</td>
                        <td>{u.mfaEnabled ? <Badge tone="ok">иә</Badge> : <Badge tone="warn">жоқ</Badge>}</td>
                        <td>{!m.revokedAt && m.role !== 'platform_admin' && <button className="btn sm danger" onClick={() => run(() => api.revokeAccess(m.id), 'Қолжетімділік қайтарылды')}>Қайтарып алу</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      {tab === 'audit' && (
        <Card title="Аудит журналы" sub={isAdmin ? 'Барлық оқиға (сомалар жасырылған)' : tenantForAudit ? 'Таңдалған компания' : 'Тек өз әрекеттеріңіз'}>
          <div className="tbl-wrap" style={{ maxHeight: 600 }}>
            <table className="tbl small">
              <thead><tr><th>Уақыты</th><th>Пайдаланушы</th><th>Рөл</th><th>Әрекет</th><th>Нысан</th><th>Нәтиже</th><th>Толығырақ</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="num">{fmtDateTime(a.at)}</td>
                    <td>{api.userName(a.userId)}</td>
                    <td>{a.role ? ROLE_LABEL[a.role] : '—'}</td>
                    <td>{a.action}</td>
                    <td>{a.entity}</td>
                    <td><Badge tone={a.result === 'ok' ? 'ok' : 'danger'}>{a.result}</Badge></td>
                    <td className="small">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'prod' && (
        <div className="grid g3">
          {PRODUCTION_CHECKLIST.map((s) => (
            <Card key={s.area} title={s.area}>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
