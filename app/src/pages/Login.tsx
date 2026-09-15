import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorNote, Field, Input } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { coordinator: 'Service desk', manager: 'Manager', engineer: 'Engineer', sales: 'Sales & estimating', stores: 'Stores', admin: 'Admin' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useApi<any[]>('/auth/demo-users');

  const submit = async (e?: string, pw?: string) => {
    setBusy(true);
    setError(null);
    try {
      const u = await login(e ?? email, pw ?? password);
      navigate(u.role === 'engineer' ? '/m' : '/', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <div className="flex flex-col justify-between bg-navy-900 px-8 py-8 text-steel-100 lg:w-[44%] lg:px-12 lg:py-12">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-10 rounded-full bg-white p-0.5" />
          <div>
            <div className="text-lg font-semibold text-white">FrostLine Ops</div>
            <div className="text-sm text-steel-100/70">Frostline Mechanical Services Ltd</div>
          </div>
        </div>
        <div className="my-10 max-w-md">
          <h1 className="text-3xl leading-tight font-semibold text-white">Calls, engineers, equipment and quotes in one place.</h1>
          <p className="mt-4 text-steel-100/80">Log a breakdown, see who can get there inside the SLA, book them, and follow the job through parts, quotes and invoicing — or just ask the assistant to do it.</p>
        </div>
        <div className="hidden text-xs text-steel-100/50 lg:block">Bury depot · Greater Manchester, Lancashire, Merseyside, Cheshire, West Yorkshire</div>
      </div>
      <div className="flex flex-1 items-start justify-center px-6 py-10 lg:items-center">
        <div className="w-full max-w-md">
          <h2 className="text-xl font-semibold text-navy-900">Sign in</h2>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorNote error={error} />
            <Button variant="primary" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>
          {!!demo.data?.length && (
            <div className="mt-8">
              <div className="text-sm font-medium text-ink">Demo accounts</div>
              <p className="text-xs text-muted">Password for all: frostline. Pick someone to see their view.</p>
              <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {demo.data
                  .filter((u, i, arr) => arr.findIndex((x) => x.role === u.role) === i || ['Rachel Dunn', 'Dave Whittaker', 'Lee Ashworth', 'Gareth Lloyd', 'Susan Mercer'].includes(u.name))
                  .slice(0, 10)
                  .map((u) => (
                    <button key={u.id} onClick={() => submit(u.email, 'frostline')} className="rounded-md border border-line bg-white px-3 py-2 text-left hover:border-steel-500">
                      <div className="text-sm font-medium text-ink">{u.name}</div>
                      <div className="text-xs text-muted">
                        {ROLE_LABEL[u.role]} · {u.job_title}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
