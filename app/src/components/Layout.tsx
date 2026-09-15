import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarRange,
  ClipboardList,
  FileSignature,
  FileText,
  Gauge,
  Inbox,
  LogOut,
  Menu,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wrench,
  CalendarClock,
} from 'lucide-react';
import { useAuth, perms } from '../lib/auth';
import { api, useApi } from '../lib/api';
import { useAi } from './AiPanel';
import { cx } from './ui';

const NAV = [
  { group: 'Service desk', items: [
    { to: '/', label: 'Dashboard', icon: Gauge, end: true },
    { to: '/inbox', label: 'Inbox', icon: Inbox, badge: 'new_enquiries' },
    { to: '/jobs', label: 'Jobs', icon: ClipboardList },
    { to: '/schedule', label: 'Schedule', icon: CalendarRange },
    { to: '/ppm', label: 'Planned maintenance', icon: CalendarClock },
  ] },
  { group: 'Customers', items: [
    { to: '/customers', label: 'Customers & sites', icon: Building2 },
    { to: '/equipment', label: 'Equipment', icon: Wrench },
    { to: '/contracts', label: 'Contracts', icon: FileSignature },
    { to: '/quotes', label: 'Quotes', icon: FileText },
  ] },
  { group: 'Operations', items: [
    { to: '/engineers', label: 'Engineers', icon: Users },
    { to: '/stock', label: 'Stock & purchasing', icon: Boxes },
    { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
    { to: '/invoicing', label: 'Ready to invoice', icon: Receipt, perm: 'manageJobs' as const },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    { to: '/settings', label: 'Settings', icon: Settings, perm: 'manager' as const },
  ] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const p = perms(user);
  const { open: aiOpen, setOpen: setAiOpen } = useAi();
  const [mobileNav, setMobileNav] = useState(false);
  const dash = useApi<any>('/dashboard', { refetchInterval: 60_000 });

  return (
    <div className={cx('flex h-full transition-[padding] duration-200', aiOpen && 'sm:pr-[420px]')}>
      <nav className={cx('fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-navy-900 text-steel-100 transition-transform lg:static lg:translate-x-0', mobileNav ? 'translate-x-0' : '-translate-x-full')}>
        <Link to="/" className="flex items-center gap-2.5 px-5 py-4" onClick={() => setMobileNav(false)}>
          <img src="/logo.svg" alt="" className="size-8 rounded-full bg-white p-0.5" />
          <div>
            <div className="text-[15px] leading-tight font-semibold text-white">FrostLine Ops</div>
            <div className="text-xs text-steel-100/60">Frostline Mechanical Services</div>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => (
            <div key={g.group} className="mt-4">
              <div className="px-2 pb-1 text-xs text-steel-100/50">{g.group}</div>
              {g.items
                .filter((i: any) => !i.perm || p[i.perm as keyof typeof p])
                .map((i: any) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.end}
                    onClick={() => setMobileNav(false)}
                    className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px]', isActive ? 'bg-navy-700 font-medium text-white' : 'text-steel-100/85 hover:bg-navy-800 hover:text-white')}
                  >
                    <i.icon className="size-4 opacity-80" />
                    <span className="flex-1">{i.label}</span>
                    {i.badge && dash.data?.counts?.[i.badge] > 0 && <span className="num rounded-full bg-hot px-1.5 text-xs font-semibold text-white">{dash.data.counts[i.badge]}</span>}
                  </NavLink>
                ))}
            </div>
          ))}
          {user?.engineer_id && (
            <NavLink to="/m" className="mt-4 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-steel-100/85 hover:bg-navy-800">
              <Smartphone className="size-4" /> Engineer app
            </NavLink>
          )}
        </div>
        <div className="border-t border-navy-700 px-4 py-3">
          <div className="text-sm font-medium text-white">{user?.name}</div>
          <div className="flex items-center justify-between text-xs text-steel-100/60">
            <span>{user?.job_title}</span>
            <button onClick={logout} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-navy-800 hover:text-white" title="Sign out">
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </nav>
      {mobileNav && <div className="fixed inset-0 z-20 bg-navy-950/40 lg:hidden" onClick={() => setMobileNav(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur lg:px-6">
          <button className="rounded p-1.5 hover:bg-paper lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu">
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <div className="flex-1" />
          {!aiOpen && (
            <button onClick={() => setAiOpen(true)} className="flex items-center gap-2 rounded-md bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700">
              <Sparkles className="size-4" /> Ask Frostline
            </button>
          )}
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { ask } = useAi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (term.trim().length < 2) return setResults(null);
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(term)}`).then(setResults), 180);
    return () => clearTimeout(t);
  }, [term]);

  const go = (to: string) => {
    setOpen(false);
    setTerm('');
    navigate(to);
  };
  const groups: [string, string, (r: any) => [string, string]][] = [
    ['customers', 'Customers', (r) => [r.name, r.account_no]],
    ['sites', 'Sites', (r) => [r.name, `${r.customer_name} · ${r.postcode ?? ''}`]],
    ['jobs', 'Jobs', (r) => [`${r.job_no} ${r.title}`, r.site_name]],
    ['quotes', 'Quotes', (r) => [`${r.quote_no} ${r.title}`, r.status]],
    ['assets', 'Equipment', (r) => [`${r.tag} ${r.category}`, `${r.manufacturer ?? ''} ${r.model ?? ''} · ${r.site_name}`]],
    ['contacts', 'Contacts', (r) => [r.name, `${r.customer_name} · ${r.phone ?? r.email ?? ''}`]],
  ];
  const paths: Record<string, (r: any) => string> = { customers: (r) => `/customers/${r.id}`, sites: (r) => `/sites/${r.id}`, jobs: (r) => `/jobs/${r.id}`, quotes: (r) => `/quotes/${r.id}`, assets: (r) => `/assets/${r.id}`, contacts: (r) => `/customers/${r.customer_id}` };
  const any = results && groups.some(([k]) => results[k]?.length);

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
      <input
        ref={ref}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), ref.current?.blur())}
        placeholder="Search customers, sites, postcodes, jobs, serials…  ⌘K"
        className="h-9 w-full rounded-md border border-line bg-paper pr-3 pl-8 text-sm focus:border-steel-500 focus:bg-white focus:outline-none"
      />
      {open && term.trim().length >= 2 && results && (
        <div className="absolute top-11 right-0 left-0 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
          {groups.map(([k, label, fmt]) =>
            results[k]?.length ? (
              <div key={k} className="py-1">
                <div className="px-3 py-1 text-xs text-muted">{label}</div>
                {results[k].map((r: any) => {
                  const [a, b] = fmt(r);
                  return (
                    <button key={r.id} onMouseDown={() => go(paths[k](r))} className="block w-full px-3 py-1.5 text-left hover:bg-steel-50">
                      <div className="truncate text-sm text-ink">{a}</div>
                      <div className="truncate text-xs text-muted">{b}</div>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )}
          {!any && <div className="px-3 py-2 text-sm text-muted">No matching records.</div>}
          <button
            onMouseDown={() => {
              ask(term);
              setTerm('');
            }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-navy-800 hover:bg-steel-50"
          >
            <Sparkles className="size-4" /> Ask the assistant: “{term}”
          </button>
        </div>
      )}
    </div>
  );
}
