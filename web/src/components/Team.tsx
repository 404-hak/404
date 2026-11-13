import { useEffect, useState, type FormEvent } from 'react';
import type { JournalEntry, Role, TeamMember } from '../types';
import { api, useMe } from '../live';
import { Card } from '../pages/common';
import { copyText, toast } from '../upkUi';

const ROLE: Record<Role, string> = { observer: 'наблюдатель', duty: 'дежурный', senior: 'старший' };
const ACTION: Record<string, string> = {
  'alert.status': 'тревога', 'alert.add': 'тревога вручную', 'auth.login': 'вход', 'auth.logout': 'выход', 'auth.fail': 'неверный пароль',
  'user.add': 'добавлен человек', 'user.update': 'изменён человек', 'user.reset': 'новый пароль', 'demo.run': 'демо', 'demo.reset': 'сброс демо',
};
const STATUS: Record<string, string> = { new: 'новая', intercept: 'перехват', resolved: 'закрыта' };
const when = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Astrakhan', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function describe(e: JournalEntry) {
  const d = e.data as Record<string, string | boolean | null>;
  if (e.action === 'alert.status') return `${d.kind ? `${d.kind} · ` : ''}${d.buoy ?? e.target}: ${STATUS[String(d.before)] ?? d.before} → ${STATUS[String(d.after)] ?? d.after}`;
  if (e.action.startsWith('user.')) return `${e.target}${d.role ? ` · ${ROLE[d.role as Role] ?? d.role}` : ''}${d.disabled ? ' · отключён' : ''}${d.reset ? ' · новый пароль' : ''}`;
  if (e.action === 'auth.fail') return `логин ${e.target}`;
  return e.target ?? '';
}

/** Журнал действий: кто что сделал. Каждая запись сцеплена с предыдущей SHA-256 — подмену видно при проверке */
export function JournalCard({ refresh = 0 }: { refresh?: number }) {
  const me = useMe();
  const [rows, setRows] = useState<JournalEntry[] | null>(null);
  useEffect(() => { if (me.role !== 'observer') api.journal(60).then(setRows).catch(() => setRows([])); }, [refresh, me.role]);
  if (me.role === 'observer') return null;
  return (
    <Card title="Журнал действий" note="кто и что сделал · сцеплено SHA-256" className="mt-4" delay={120}>
      {!rows ? <p className="text-[13px] text-muted">Загружаю…</p> : rows.length === 0 ? <p className="text-[13px] text-muted">Пока ничего не записано.</p> : (
        <ul className="max-h-[360px] overflow-y-auto">
          {rows.map((e) => (
            <li key={e.seq} className="grid grid-cols-[92px_1fr_auto] items-baseline gap-3 border-b border-line py-2 text-[13px] last:border-0">
              <span className="font-mono text-[11px] text-muted">{when.format(new Date(e.ts))}</span>
              <span className="min-w-0"><b className="font-semibold">{e.actor}</b> <span className="text-muted">· {ACTION[e.action] ?? e.action}</span>
                <span className="block truncate text-[12px] text-muted">{describe(e)}</span></span>
              <span className="font-mono text-[10px] text-muted" title={`SHA-256 записи: ${e.hash}`}>#{e.seq}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Команда — только для старшего: добавить человека, сменить роль, выдать новый пароль, отключить */
export function TeamCard() {
  const me = useMe();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [form, setForm] = useState({ login: '', name: '', role: 'duty' as Role });
  const [secret, setSecret] = useState<{ login: string; password: string } | null>(null);
  const load = () => api.team().then(setTeam).catch(() => setTeam([]));
  useEffect(() => { if (me.role === 'senior' && me.accounts) void load(); }, [me.role, me.accounts]);
  if (me.role !== 'senior' || !me.accounts) return null;

  const add = async (ev: FormEvent) => {
    ev.preventDefault();
    try {
      const r = await api.addMember(form);
      setSecret(r);
      setForm({ login: '', name: '', role: 'duty' });
      void load();
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const patch = async (login: string, p: { role?: Role; disabled?: boolean; reset_password?: boolean }) => {
    try {
      const r = await api.patchMember(login, p);
      if (r.password) setSecret({ login, password: r.password });
      void load();
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const field = 'h-10 rounded-[10px] border border-line bg-bg/60 px-3 text-[13.5px] outline-none focus:border-accent';
  return (
    <Card title="Команда" note="вход по логину и паролю · роль решает, какие кнопки видны" className="mt-4" delay={160}>
      {secret && (
        <div className="enter mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-accent/50 bg-accent/10 px-4 py-3 text-[13.5px]" role="status">
          <span>Пароль для <b>{secret.login}</b>: <code className="font-mono text-[14px]">{secret.password}</code> — передайте лично, повторно он не покажется.</span>
          <button type="button" className="ui-btn ui-btn-soft ui-btn-sm" onClick={() => copyText(secret.password, 'Пароль скопирован')}>Копировать</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSecret(null)}>Скрыть</button>
        </div>
      )}
      <ul className="mb-4">
        {(team ?? []).map((u) => (
          <li key={u.login} className={`flex flex-wrap items-center gap-3 border-b border-line py-2.5 text-[13.5px] last:border-0 ${u.disabled ? 'opacity-50' : ''}`}>
            <span className="min-w-[160px] flex-1"><b className="font-semibold">{u.name}</b> <span className="font-mono text-[12px] text-muted">{u.login}</span></span>
            <select value={u.role} onChange={(e) => patch(u.login, { role: e.target.value as Role })} disabled={u.login === me.login} className={`${field} h-8 text-[12.5px]`} aria-label={`Роль: ${u.name}`}>
              {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
            </select>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => patch(u.login, { reset_password: true })}>Новый пароль</button>
            {u.login !== me.login && (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => patch(u.login, { disabled: !u.disabled })}>{u.disabled ? 'Включить' : 'Отключить'}</button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <input className={`${field} w-[150px]`} placeholder="логин" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required aria-label="Логин" autoComplete="off" />
        <input className={`${field} min-w-[180px] flex-1`} placeholder="Имя, как в журнале" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Имя" autoComplete="off" />
        <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} aria-label="Роль">
          {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
        </select>
        <button type="submit" className="ui-btn ui-btn-primary h-10 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-bg">Добавить</button>
      </form>
    </Card>
  );
}
