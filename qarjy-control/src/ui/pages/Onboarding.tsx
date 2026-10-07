import { useState } from 'react';
import { useApp } from '../ctx';
import { Badge, Card, Forbidden, NotImplemented } from '../components/ui';
import type { OnboardInput } from '../../server/api';
import { DEFAULT_CHECKLIST } from '../../domain/seed';
import { TARIFFS, PRICE_FACTORS } from './Service';
import { tenge } from '../../domain/money';

const STEPS = ['Компания', 'Нүктелер', '1С', 'Көлем', 'Есеп жағдайы', 'Қызмет көлемі', 'Міндеттер', 'Рұқсат', 'Диагностика', 'Команда'];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function OnboardingPage() {
  const { api, run, go, setSession } = useApp();
  const [step, setStep] = useState(0);
  const [fee, setFee] = useState('');
  const [f, setF] = useState<OnboardInput>({
    companyName: '', legalName: '', bin: '', contactPerson: '', contactPhone: '', contactEmail: '', description: '', industry: 'retail', serviceMode: 'outsourcing',
    branches: [''], oneC: { configuration: '1С:Розница', version: '', hosting: 'on_premise', method: 'mock' }, volumes: { bankAccounts: 1, cashRegisters: 1, warehouses: 1, docsPerMonth: 300, employees: 5 },
    accountingState: 'partial', restorationNeeded: false, restorationHours: null, tariff: 'accounting', monthlyFee: null, includedUnits: 30,
    includedWorks: ['Бастапқы құжаттарды 1С-те өңдеу', 'Банк пен кассаны салыстыру', 'Ай жабу'], excludedWorks: ['Өткен кезеңдерді қалпына келтіру', 'Кадрлық іс жүргізу'],
    clientDocuments: [{ name: 'Жалдау және қызмет актілері', deadline: 'Келесі айдың 3-күніне дейін' }], clientDuties: ['Бастапқы құжаттарды уақтылы беру'], ourDuties: ['Ай жабу — келесі айдың 7-күніне дейін'],
    accessConfirmed: false, checklist: DEFAULT_CHECKLIST.map((c) => c.id), diagnostics: [], accountantId: '', reviewerId: 'u_chief', slaHours: 24, startDate: api.today(),
  });
  if (!api.canAnywhere('onboarding')) return <Forbidden message="Клиентті қосу тек қызмет жетекшісіне" />;
  const set = (p: Partial<OnboardInput>) => setF({ ...f, ...p });
  const accountants = api.db.users.filter((u) => api.db.memberships.some((m) => m.userId === u.id && m.role === 'accountant' && !m.revokedAt));
  const suggestedUnits = Math.max(10, Math.round(f.volumes.docsPerMonth / 12) + f.branches.filter(Boolean).length * 4 + (f.volumes.warehouses > 1 ? 6 : 0));
  const diagnostics = [
    `Есептің жағдайы: ${f.accountingState === 'good' ? 'жақсы' : f.accountingState === 'partial' ? 'ішінара тәртіпте' : 'қараусыз қалған'}${f.restorationNeeded ? ` → қалпына келтіру бөлек бағаланады (${f.restorationHours ?? '?'} сағ)` : ''}`,
    `Құжат көлемі ${f.volumes.docsPerMonth}/ай, ${f.branches.filter(Boolean).length} нүкте, ${f.volumes.warehouses} қойма → ұсынылатын лимит ≈ ${suggestedUnits} бірлік/ай (demo формула)`,
    `1С: ${f.oneC.configuration} ${f.oneC.version || '(нұсқа белгісіз)'} · ${f.oneC.hosting} · тәсіл: ${f.oneC.method}${f.oneC.method === 'odata' || f.oneC.method === 'http_service' ? ' → MVP-де адаптер жоқ, бастапқыда CSV/Mock' : ''}`,
    f.accessConfirmed ? 'Оқу режиміндегі рұқсат клиентпен келісілді' : '⚠ Деректерге рұқсат әлі расталмаған',
    'Бастапқы тексерулер деректер жүктелгеннен кейін іске қосылады (дерек жоқ кезде көрсеткіштер «Дерек жоқ»)',
  ];
  const canNext = [f.companyName.trim().length > 2 && f.contactPerson.trim().length > 2, f.branches.some((b) => b.trim()), !!f.oneC.configuration, true, true, f.includedUnits > 0, true, f.accessConfirmed, true, !!f.accountantId][step];
  const submit = () => {
    const r = run(() => api.onboard({ ...f, branches: f.branches.filter((b) => b.trim()), monthlyFee: f.tariff === 'control' || !fee ? null : tenge(fee), diagnostics }), 'Клиент қосылды');
    if (r && r !== true) {
      setSession({ tenantId: r.tenantId, branchId: null });
      go(`/client/${r.tenantId}`);
    }
  };
  return (
    <div className="col gap16">
      <h1>Жаңа клиентті қызметке қосу</h1>
      <div className="wizard-steps">
        {STEPS.map((s, i) => <button key={s} className={`ws ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i <= step && setStep(i)}>{i + 1}. {s}</button>)}
      </div>
      <Card>
        {step === 0 && (
          <div className="grid g2">
            <label className="field">Компания атауы *<input value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} /></label>
            <label className="field">Заңды атауы<input value={f.legalName} onChange={(e) => set({ legalName: e.target.value })} /></label>
            <label className="field">БСН/ЖСН<input value={f.bin} onChange={(e) => set({ bin: e.target.value })} /></label>
            <label className="field">Байланыс тұлғасы (кәсіп иесі) *<input value={f.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></label>
            <label className="field">Телефон<input value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} /></label>
            <label className="field">Email<input value={f.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></label>
          </div>
        )}
        {step === 1 && (
          <div className="col">
            <div className="row">
              <label className="field">Сала<select value={f.industry} onChange={(e) => set({ industry: e.target.value as OnboardInput['industry'] })}><option value="retail">Бөлшек сауда</option><option value="wholesale">Көтерме сауда</option></select></label>
              <label className="field">Қызмет режимі<select value={f.serviceMode} onChange={(e) => set({ serviceMode: e.target.value as OnboardInput['serviceMode'] })}><option value="outsourcing">Біздің команда орындайтын аутсорсинг</option><option value="control">Клиент бухгалтерлерімен бірге бақылау</option></select></label>
            </div>
            <label className="field">Қысқаша сипаттама<input value={f.description} onChange={(e) => set({ description: e.target.value })} /></label>
            <b className="small">Сауда нүктелері *</b>
            {f.branches.map((b, i) => (
              <div className="row" key={i}>
                <input className="grow" value={b} placeholder={`Нүкте ${i + 1}`} onChange={(e) => set({ branches: f.branches.map((x, j) => (j === i ? e.target.value : x)) })} />
                {f.branches.length > 1 && <button className="btn sm" onClick={() => set({ branches: f.branches.filter((_, j) => j !== i) })}>×</button>}
              </div>
            ))}
            <button className="btn sm" onClick={() => set({ branches: [...f.branches, ''] })}>+ нүкте</button>
            <div className="small muted">MVP сауда бизнесіне арналған. Басқа салалар үшін құрылым (Industry) кеңейтіледі.</div>
          </div>
        )}
        {step === 2 && (
          <div className="grid g2">
            <label className="field">Конфигурация<select value={f.oneC.configuration} onChange={(e) => set({ oneC: { ...f.oneC, configuration: e.target.value } })}>{['1С:Розница', '1С:Управление торговлей', '1С:Бухгалтерия для Казахстана', '1С:Комплексная автоматизация', 'Басқа / белгісіз'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Нұсқа<input value={f.oneC.version} placeholder="мысалы 2.3.x" onChange={(e) => set({ oneC: { ...f.oneC, version: e.target.value } })} /></label>
            <label className="field">Орналастыру<select value={f.oneC.hosting} onChange={(e) => set({ oneC: { ...f.oneC, hosting: e.target.value as OnboardInput['oneC']['hosting'] } })}><option value="on_premise">Клиент серверінде</option><option value="cloud_vps">Бұлттағы сервер</option><option value="saas_1c">1С бұлттық сервисі</option><option value="unknown">Белгісіз</option></select></label>
            <label className="field">Қосылу тәсілі<select value={f.oneC.method} onChange={(e) => set({ oneC: { ...f.oneC, method: e.target.value as OnboardInput['oneC']['method'] } })}><option value="mock">MockConnector (demo)</option><option value="csv">CSV импорт</option><option value="odata">OData</option><option value="http_service">HTTP-сервис</option></select></label>
            {(f.oneC.method === 'odata' || f.oneC.method === 'http_service') && <div className="span2"><NotImplemented>Бұл адаптер MVP-де іске асырылмаған — бастапқыда CSV/Mock қолданылады</NotImplemented></div>}
            <div className="span2 callout small">Барлық 1С базасы бірдей емес: тәсіл конфигурацияға, нұсқаға, типтік емес өзгерістерге және қолжетімділікке қарай таңдалады. Алғашқы кезеңде — тек оқу режимі.</div>
          </div>
        )}
        {step === 3 && (
          <div className="grid g3">
            {([['bankAccounts', 'Банк шоттары'], ['cashRegisters', 'Кассалар'], ['warehouses', 'Қоймалар'], ['docsPerMonth', 'Құжат/ай'], ['employees', 'Қызметкерлер']] as const).map(([k, l]) => (
              <label key={k} className="field">{l}<input type="number" min={0} value={f.volumes[k]} onChange={(e) => set({ volumes: { ...f.volumes, [k]: parseInt(e.target.value || '0', 10) } })} /></label>
            ))}
          </div>
        )}
        {step === 4 && (
          <div className="col">
            <label className="field">Есептің қазіргі жағдайы<select value={f.accountingState} onChange={(e) => set({ accountingState: e.target.value as OnboardInput['accountingState'] })}><option value="good">Жақсы: ай сайын жабылады</option><option value="partial">Ішінара: кейбір айлар/салыстырулар жоқ</option><option value="neglected">Қараусыз: қалпына келтіру керек</option></select></label>
            <label className="row small"><input type="checkbox" checked={f.restorationNeeded} onChange={(e) => set({ restorationNeeded: e.target.checked })} /> Бастапқы есепті қалпына келтіру қажет (тұрақты айлық қызметтен бөлек бағаланады)</label>
            {f.restorationNeeded && <label className="field" style={{ maxWidth: 240 }}>Бағаланған сағат<input type="number" value={f.restorationHours ?? ''} onChange={(e) => set({ restorationHours: e.target.value ? parseInt(e.target.value, 10) : null })} /></label>}
          </div>
        )}
        {step === 5 && (
          <div className="col">
            <div className="row">
              {TARIFFS.map((t) => <button key={t.code} className={`btn ${f.tariff === t.code ? 'primary' : ''}`} onClick={() => set({ tariff: t.code })}>{t.name}</button>)}
            </div>
            <div className="grid g2">
              <label className="field">Айлық лимит (күрделілік бірлігі) · ұсыныс: {suggestedUnits}<input type="number" value={f.includedUnits} onChange={(e) => set({ includedUnits: parseInt(e.target.value || '0', 10) })} /></label>
              <label className="field">Айлық төлем, ₸ (demo; бос — жеке есептеледі)<input value={fee} disabled={f.tariff === 'control'} onChange={(e) => setFee(e.target.value)} /></label>
              <label className="field">Кіретін жұмыстар (әр жол — бір жұмыс)<textarea value={f.includedWorks.join('\n')} onChange={(e) => set({ includedWorks: lines(e.target.value) })} /></label>
              <label className="field">Кірмейтін жұмыстар<textarea value={f.excludedWorks.join('\n')} onChange={(e) => set({ excludedWorks: lines(e.target.value) })} /></label>
            </div>
            <div className="small muted">Бағалау факторлары: {PRICE_FACTORS.join(' · ')}</div>
          </div>
        )}
        {step === 6 && (
          <div className="grid g2">
            <label className="field">Клиенттің міндеттері<textarea value={f.clientDuties.join('\n')} onChange={(e) => set({ clientDuties: lines(e.target.value) })} /></label>
            <label className="field">Біздің команданың міндеттері<textarea value={f.ourDuties.join('\n')} onChange={(e) => set({ ourDuties: lines(e.target.value) })} /></label>
            <label className="field span2">Клиент тапсыратын құжаттар (формат: атауы | мерзімі)<textarea value={f.clientDocuments.map((d) => `${d.name} | ${d.deadline}`).join('\n')} onChange={(e) => set({ clientDocuments: lines(e.target.value).map((l) => { const [name, deadline = ''] = l.split('|').map((x) => x.trim()); return { name, deadline }; }) })} /></label>
          </div>
        )}
        {step === 7 && (
          <div className="col">
            <label className="row"><input type="checkbox" checked={f.accessConfirmed} onChange={(e) => set({ accessConfirmed: e.target.checked })} /> Клиент 1С деректерін <b>тек оқу</b> режимінде беруге келісті *</label>
            <div className="callout small">
              Рұқсаттар: кәсіп иесі — өз компаниясы; бухгалтер мен бас бухгалтер — бекітілген компания; интегратор — техникалық журнал (қаржыға рұқсат бөлек); платформа әкімшісі — клиент деректеріне әдепкі рұқсатсыз. Құпия кілттер тек серверде сақталады (production).
            </div>
            <div className="small">1С-ке жазу (түзетулерді енгізу) — кейінгі кезең: ұсыныс → тексеру → бекіту → орындау → қайта оқу. <NotImplemented /></div>
          </div>
        )}
        {step === 8 && (
          <div className="col">
            <h3>Бастапқы диагностика</h3>
            <ul className="small">{diagnostics.map((d) => <li key={d}>{d}</li>)}</ul>
            <h4>Ай жабу чек-листі (клиенттің есеп саясатына қарай)</h4>
            {DEFAULT_CHECKLIST.map((c) => (
              <label key={c.id} className="row small"><input type="checkbox" checked={f.checklist.includes(c.id)} onChange={(e) => set({ checklist: e.target.checked ? [...f.checklist, c.id] : f.checklist.filter((x) => x !== c.id) })} /> {c.label}</label>
            ))}
          </div>
        )}
        {step === 9 && (
          <div className="grid g2">
            <label className="field">Жауапты бухгалтер *<select value={f.accountantId} onChange={(e) => set({ accountantId: e.target.value })}><option value="">— таңдаңыз —</option>{accountants.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="field">Тексеруші<select value={f.reviewerId} onChange={(e) => set({ reviewerId: e.target.value })}><option value="u_chief">{api.userName('u_chief')}</option></select></label>
            <label className="field">Жауап беру мерзімі (SLA), сағ<input type="number" value={f.slaHours} onChange={(e) => set({ slaHours: parseInt(e.target.value || '24', 10) })} /></label>
            <label className="field">Қызмет басталатын күн<input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
            <div className="span2 callout small">Бекіткеннен кейін: tenant жасалады (оқшауланған), кәсіп иесінің пайдаланушысы, 1С қосылымы («қосылмаған»), қызмет келісімі, ай жабу чек-листі және бастапқы диагностика тапсырмасы құрылады. <Badge tone="outline">DEMO</Badge></div>
          </div>
        )}
      </Card>
      <div className="row between">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Артқа</button>
        {step < STEPS.length - 1 ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Келесі →</button> : <button className="btn primary" disabled={!canNext} onClick={submit}>Клиентті қосу және бекіту</button>}
      </div>
    </div>
  );
}
