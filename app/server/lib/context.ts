import { insert } from '../db/index.ts';

export type Role = 'admin' | 'manager' | 'coordinator' | 'engineer' | 'sales' | 'stores';

export interface Actor {
  userId: number;
  name: string;
  role: Role;
  engineerId: number | null;
  viaAi?: boolean;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);

export function audit(actor: Actor | null, entity_type: string, entity_id: number, action: string, detail?: string) {
  insert('audit_log', {
    entity_type,
    entity_id,
    user_id: actor?.userId ?? null,
    action,
    detail: detail ?? null,
    via_ai: actor?.viaAi ? 1 : 0,
  });
}

const OFFICE: Role[] = ['admin', 'manager', 'coordinator', 'sales', 'stores'];

export const can = {
  office: (a: Actor) => OFFICE.includes(a.role),
  manageJobs: (a: Actor) => ['admin', 'manager', 'coordinator'].includes(a.role),
  schedule: (a: Actor) => ['admin', 'manager', 'coordinator'].includes(a.role),
  quotes: (a: Actor) => ['admin', 'manager', 'sales', 'coordinator'].includes(a.role),
  approveQuotes: (a: Actor) => ['admin', 'manager', 'sales'].includes(a.role),
  contracts: (a: Actor) => ['admin', 'manager', 'sales'].includes(a.role),
  stock: (a: Actor) => ['admin', 'manager', 'stores', 'coordinator'].includes(a.role),
  invoicing: (a: Actor) => ['admin', 'manager'].includes(a.role),
  admin: (a: Actor) => a.role === 'admin',
  crmEdit: (a: Actor) => ['admin', 'manager', 'coordinator', 'sales'].includes(a.role),
};

export function ensure(ok: boolean, msg?: string) {
  if (!ok) throw forbidden(msg);
}
