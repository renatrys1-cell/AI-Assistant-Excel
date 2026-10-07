import { useApp, primaryRole } from '../ctx';
import { ROLE_LABEL } from '../../server/authz';
import { Badge } from '../components/ui';
import { Api } from '../../server/api';

const SCENARIOS: [string, string][] = [
  ['Ерлан Сапаров (кәсіп иесі)', 'Басты беттен мәселені ашып, бухгалтерге тапсыру; шешім күтіп тұрған сұрақтарға жауап беру; AI-дан сұрау'],
  ['Дәурен Мұратов (бухгалтер)', 'Тапсырманы бастау, «1С-те түзетілді» дәлелін қосу, тексеруге жіберу'],
  ['Гүлнар Әбенова (бас бухгалтер)', 'Тексеруді қабылдау/қайтару, қайта тексеру, мәселені жабу, ай жабу чек-листі'],
  ['Бауыржан Кенжебаев (қызмет жетекшісі)', 'Команда жүктемесі, KPI коэффициенттері, қызмет экономикасы, жаңа клиент шебері'],
  ['Тимур Омаров (интегратор)', 'Кешіккен синхрондауды қайта іске қосу, CSV импорт, журнал'],
];

export function LoginPage({ onLogin, onReset }: { onLogin: (userId: string) => void; onReset: () => void }) {
  const { db } = useApp();
  return (
    <div className="login">
      <div className="login-box col gap16">
        <div className="row between">
          <div className="row">
            <span className="brand-mark" style={{ width: 36, height: 36, color: '#fff' }}>Q</span>
            <div>
              <h1>{db.settings.platformName}</h1>
              <div className="muted">1С үстіндегі қаржылық бақылау және бухгалтерлік қызмет платформасы · MVP прототип</div>
            </div>
          </div>
          <Badge tone="warn">DEMO</Badge>
        </div>
        <div className="callout warn">
          Бұл — demo кіру: пароль мен MFA жоқ, рөлді таңдау арқылы кіресіз. Барлық компания мен адам ойдан құрастырылған. Нақты кіру (SSO/пароль + MFA) — production кезеңі.
        </div>
        <div className="grid g3">
          {db.users.map((u) => {
            const a = new Api(db, u.id);
            const roles = a.allRoles();
            const r = primaryRole(roles);
            const tenants = a.tenants();
            return (
              <button key={u.id} className="persona" onClick={() => onLogin(u.id)}>
                <b>{u.name}</b>
                <span className="small">{r ? ROLE_LABEL[r] : '—'}</span>
                <span className="tiny muted">{tenants.length ? tenants.map((t) => t.name.replace(' (demo)', '')).join(', ') : r === 'platform_admin' ? 'Клиент деректеріне қолжетімділік жоқ' : 'Компания жоқ'}</span>
              </button>
            );
          })}
        </div>
        <div className="card">
          <h3 className="mb8">Ұсынылатын тексеру сценарийлері</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {SCENARIOS.map(([w, d]) => (
              <li key={w}>
                <b>{w}:</b> {d}
              </li>
            ))}
          </ul>
        </div>
        <div className="row">
          <button className="btn danger sm" onClick={() => confirm('Барлық demo өзгерістер өшіріледі. Жалғастырасыз ба?') && onReset()}>
            Demo деректерін бастапқы күйге қайтару
          </button>
          <span className="small muted">Өзгерістер браузерде (localStorage) сақталады және бет жаңартылғанда қалады.</span>
        </div>
      </div>
    </div>
  );
}
