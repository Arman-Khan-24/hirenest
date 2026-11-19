import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  Tabs,
} from '../../components/ui/kit';
import { useToast } from '../../components/ui/Toast';
import { staffApi, type StaffUser, type RoleTemplate } from '../../api/staff';
import {
  DEFAULT_TEMPLATES,
  MODULE_LABEL,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  RECORD_SCOPES,
  STAFF_ROLES,
  STAFF_ROLE_LABEL,
  STAFF_ROLE_DESCRIPTION,
  type PermissionSet,
  type StaffRole,
} from '../../lib/staffRbac';

const TABS = [
  { id: 'users', label: 'All Users' },
  { id: 'team_access', label: 'Team Access Matrix' },
  { id: 'add', label: 'Add User' },
  { id: 'departments', label: 'Departments' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'hierarchy', label: 'Reporting Hierarchy' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'suspended', label: 'Suspended Users' },
  { id: 'audit', label: 'Access Audit' },
];

const roleOptions = STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABEL[r] }));

export const UserTeamManagementPage: React.FC = () => {
  const [tab, setTab] = useState('users');
  const [selectedAccessUser, setSelectedAccessUser] = useState<StaffUser | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const usersQ = useQuery({ queryKey: ['staff_users'], queryFn: staffApi.users });
  const deptQ = useQuery({ queryKey: ['staff_departments'], queryFn: staffApi.departments });
  const users = usersQ.data || [];
  const depts = deptQ.data || [];
  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name || '—';
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || '—';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['staff_users'] });
    qc.invalidateQueries({ queryKey: ['staff_audit'] });
    qc.invalidateQueries({ queryKey: ['my_access'] });
  };
  const onErr = (e: unknown) =>
    toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Error', tone: 'error' });

  const suspendM = useMutation({
    mutationFn: (id: string) => staffApi.suspend(id),
    onSuccess: () => {
      toast({ title: 'User suspended — access revoked', tone: 'success' });
      refresh();
    },
    onError: onErr,
  });
  const resendM = useMutation({
    mutationFn: (id: string) => staffApi.resendInvite(id),
    onSuccess: () => toast({ title: 'Invitation re-sent', description: 'They will get a fresh activation link by email.', tone: 'success' }),
    onError: onErr,
  });
  const reactivateM = useMutation({
    mutationFn: (id: string) => staffApi.reactivate(id),
    onSuccess: () => {
      toast({ title: 'User reactivated', tone: 'success' });
      refresh();
    },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => staffApi.updateUser(v.id, v.body),
    onSuccess: () => {
      toast({ title: 'Updated and audited', tone: 'success' });
      refresh();
    },
    onError: onErr,
  });

  if (usersQ.error) {
    return <ErrorState message={`Could not load users: ${(usersQ.error as Error).message}`} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User & Team Management"
        description="Add employees, assign departments and roles, and control what each person can access."
      />
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />

      {usersQ.isLoading && <TableSkeleton rows={5} cols={5} />}

      {!usersQ.isLoading && tab === 'users' && (
        <UserTable
          users={users.filter((u) => u.status !== 'suspended')}
          deptName={deptName}
          userName={userName}
          actionLabel="Suspend"
          onAction={(u) => suspendM.mutate(u.id)}
          depts={depts}
          allUsers={users}
          onUpdate={(id, body) => updateM.mutate({ id, body })}
          onManageAccess={(u) => setSelectedAccessUser(u)}
        />
      )}

      {!usersQ.isLoading && tab === 'team_access' && (
        <TeamAccessMatrix
          users={users.filter((u) => u.status !== 'suspended')}
          deptName={deptName}
          onManageAccess={(u) => setSelectedAccessUser(u)}
        />
      )}

      {tab === 'add' && (
        <AddUserForm
          depts={depts}
          users={users}
          onDone={() => {
            refresh();
            setTab('users');
          }}
        />
      )}

      {tab === 'departments' && <Departments depts={depts} users={users} onChanged={() => qc.invalidateQueries({ queryKey: ['staff_departments'] })} />}

      {tab === 'roles' && <RolesMatrix />}

      {tab === 'hierarchy' && <Hierarchy users={users} />}

      {tab === 'invitations' && (
        <UserTable
          users={users.filter((u) => !u.activatedAt && u.status !== 'suspended')}
          deptName={deptName}
          userName={userName}
          emptyText="No pending invitations."
          actionLabel="Resend invite"
          onAction={(u) => resendM.mutate(u.id)}
          onManageAccess={(u) => setSelectedAccessUser(u)}
        />
      )}

      {tab === 'suspended' && (
        <UserTable
          users={users.filter((u) => u.status === 'suspended')}
          deptName={deptName}
          userName={userName}
          actionLabel="Reactivate"
          onAction={(u) => reactivateM.mutate(u.id)}
          emptyText="No suspended users."
        />
      )}

      {tab === 'audit' && <AccessAudit users={users} />}

      {/* User Access Modal */}
      {selectedAccessUser && (
        <UserAccessModal
          user={selectedAccessUser}
          deptName={deptName(selectedAccessUser.departmentId)}
          onClose={() => setSelectedAccessUser(null)}
          onSaved={() => {
            refresh();
            setSelectedAccessUser(null);
          }}
        />
      )}
    </div>
  );
};

const UserTable: React.FC<{
  users: StaffUser[];
  deptName: (id: string | null) => string;
  userName: (id: string | null) => string;
  actionLabel?: string;
  onAction?: (u: StaffUser) => void;
  emptyText?: string;
  depts?: Array<{ id: string; name: string }>;
  allUsers?: StaffUser[];
  onUpdate?: (id: string, body: Record<string, unknown>) => void;
  onManageAccess?: (u: StaffUser) => void;
}> = ({ users, deptName, userName, actionLabel, onAction, emptyText, depts, allUsers, onUpdate, onManageAccess }) => {
  if (users.length === 0) {
    return <p className="text-[13px] text-[var(--text-secondary)]">{emptyText || 'No users yet.'}</p>;
  }
  return (
    <div className="overflow-x-auto border-y border-[var(--border)]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[var(--text-tertiary)]">
            {['Name', 'Role', 'Department', 'Designation', 'Reports to', 'Status', 'Actions'].map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2 pr-4">
                <div className="font-medium text-[var(--text-primary)]">{u.name || '—'}</div>
                <div className="text-[12px] text-[var(--text-tertiary)]">{u.email}</div>
              </td>
              <td className="py-2 pr-4">
                {onUpdate ? (
                  <select
                    className="bg-transparent border border-[var(--border)] rounded px-1 py-1 text-[12px]"
                    value={u.role}
                    onChange={(e) => onUpdate(u.id, { role: e.target.value })}
                  >
                    {roleOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  STAFF_ROLE_LABEL[u.role]
                )}
              </td>
              <td className="py-2 pr-4">
                {onUpdate && depts ? (
                  <select
                    className="bg-transparent border border-[var(--border)] rounded px-1 py-1 text-[12px]"
                    value={u.departmentId || ''}
                    onChange={(e) => onUpdate(u.id, { departmentId: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {depts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                ) : (
                  deptName(u.departmentId)
                )}
              </td>
              <td className="py-2 pr-4">{u.designation || '—'}</td>
              <td className="py-2 pr-4">
                {onUpdate && allUsers ? (
                  <select
                    className="bg-transparent border border-[var(--border)] rounded px-1 py-1 text-[12px]"
                    value={u.reportingManagerId || ''}
                    onChange={(e) => onUpdate(u.id, { reportingManagerId: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {allUsers.filter((m) => m.id !== u.id).map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                ) : (
                  userName(u.reportingManagerId)
                )}
              </td>
              <td className="py-2 pr-4">
                <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
                  {u.status === 'active' && !u.activatedAt ? 'invited' : u.status}
                </Badge>
              </td>
              <td className="py-2 text-right">
                <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  {onManageAccess && (
                    <Button size="sm" variant="secondary" onClick={() => onManageAccess(u)}>
                      Manage Access
                    </Button>
                  )}
                  {actionLabel && onAction && (
                    <Button size="sm" variant="outline" onClick={() => onAction(u)}>{actionLabel}</Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const AddUserForm: React.FC<{
  depts: Array<{ id: string; name: string }>;
  users: StaffUser[];
  onDone: () => void;
}> = ({ depts, users, onDone }) => {
  const { toast } = useToast();
  const [f, setF] = useState({
    name: '', email: '', mobile: '', employeeId: '', departmentId: '', designation: '',
    role: 'recruiter', reportingManagerId: '', joiningDate: '', status: 'active',
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => staffApi.createUser({ ...f, departmentId: f.departmentId || null, reportingManagerId: f.reportingManagerId || null }),
    onSuccess: () => {
      toast({ title: 'Invitation sent', description: 'The employee will activate their account by email.', tone: 'success' });
      onDone();
    },
    onError: (e) => toast({ title: 'Could not add user', description: (e as Error).message, tone: 'error' }),
  });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2 max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Input label="Name" value={f.name} onChange={set('name')} required />
      <Input label="Official email" type="email" value={f.email} onChange={set('email')} required />
      <Input label="Mobile" value={f.mobile} onChange={set('mobile')} />
      <Input label="Employee ID" value={f.employeeId} onChange={set('employeeId')} />
      <Select label="Department" value={f.departmentId} onChange={set('departmentId')}
        options={[{ value: '', label: 'Select…' }, ...depts.map((d) => ({ value: d.id, label: d.name }))]} />
      <Input label="Designation" value={f.designation} onChange={set('designation')} />
      <Select label="System role / permission template" value={f.role} onChange={set('role')} options={roleOptions} />
      <p className="sm:col-span-2 -mt-2 text-[12px] text-[var(--text-tertiary)]">
        {STAFF_ROLE_DESCRIPTION[f.role as StaffRole]} Vendor Recruiters are added by their Vendor Admin inside the vendor organisation.
      </p>
      <Select label="Reporting manager" value={f.reportingManagerId} onChange={set('reportingManagerId')}
        options={[{ value: '', label: 'None' }, ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]} />
      <Input label="Joining date" type="date" value={f.joiningDate} onChange={set('joiningDate')} />
      <Select label="Account status" value={f.status} onChange={set('status')}
        options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Sending invite…' : 'Add user & send invitation'}</Button>
      </div>
    </form>
  );
};

const Departments: React.FC<{
  depts: Array<{ id: string; name: string }>;
  users: StaffUser[];
  onChanged: () => void;
}> = ({ depts, users, onChanged }) => {
  const [name, setName] = useState('');
  const { toast } = useToast();
  const add = useMutation({
    mutationFn: () => staffApi.addDepartment(name.trim()),
    onSuccess: () => { setName(''); onChanged(); },
    onError: (e) => toast({ title: 'Failed', description: (e as Error).message, tone: 'error' }),
  });
  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex gap-2 items-end">
        <Input label="New department" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => add.mutate()} disabled={name.trim().length < 2}>Add</Button>
      </div>
      <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {depts.map((d) => (
          <li key={d.id} className="py-2 flex justify-between text-[13px]">
            <span>{d.name}</span>
            <span className="text-[var(--text-tertiary)]">{users.filter((u) => u.departmentId === d.id).length} members</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const RolesMatrix: React.FC = () => {
  const q = useQuery({ queryKey: ['staff_templates'], queryFn: staffApi.templates });
  const [role, setRole] = useState<StaffRole>('senior_bom');
  const [draft, setDraft] = useState<PermissionSet | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const tpl: RoleTemplate | undefined = q.data?.find((t) => t.role === role);
  const perms = draft || tpl?.permissions || {};
  const save = useMutation({
    mutationFn: () => staffApi.saveTemplate(role, perms),
    onSuccess: () => {
      toast({ title: 'Template saved and audited', tone: 'success' });
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['staff_templates'] });
    },
    onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, tone: 'error' }),
  });
  const toggle = (mod: (typeof PERMISSION_MODULES)[number], action: (typeof PERMISSION_ACTIONS)[number]) => {
    const cur = perms[mod] || { scope: 'own' as const, actions: [] };
    const actions = cur.actions.includes(action) ? cur.actions.filter((a) => a !== action) : [...cur.actions, action];
    setDraft({ ...perms, [mod]: { ...cur, actions } });
  };
  const setScope = (mod: (typeof PERMISSION_MODULES)[number], scope: (typeof RECORD_SCOPES)[number]) => {
    const cur = perms[mod] || { scope, actions: [] };
    setDraft({ ...perms, [mod]: { ...cur, scope } });
  };
  const editable = role !== 'platform_admin';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Role" value={role} onChange={(e) => { setRole(e.target.value as StaffRole); setDraft(null); }} options={roleOptions} />
        {draft && editable && <Button onClick={() => save.mutate()} disabled={save.isPending}>Save template</Button>}
        {tpl?.customised && <Badge tone="info">customised</Badge>}
      </div>
      <p className="text-[12px] text-[var(--text-tertiary)]">
        Seniority never implies admin access. Platform security and billing can only be held by a Platform Admin. Only a Platform Admin can save changes.
      </p>
      <div className="overflow-x-auto border-y border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[var(--text-tertiary)]">
              <th className="py-2 pr-3 font-medium">Module</th>
              <th className="py-2 pr-3 font-medium">Scope</th>
              {PERMISSION_ACTIONS.map((a) => <th key={a} className="py-2 px-1 font-medium capitalize">{a.replace('_', ' ')}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {PERMISSION_MODULES.map((mod) => (
              <tr key={mod}>
                <td className="py-2 pr-3">{MODULE_LABEL[mod]}</td>
                <td className="py-2 pr-3">
                  <select disabled={!editable} className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5"
                    value={perms[mod]?.scope || 'own'} onChange={(e) => setScope(mod, e.target.value as never)}>
                    {RECORD_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                {PERMISSION_ACTIONS.map((a) => (
                  <td key={a} className="py-2 px-1 text-center">
                    <input type="checkbox" disabled={!editable} checked={Boolean(perms[mod]?.actions.includes(a))} onChange={() => toggle(mod, a)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Hierarchy: React.FC<{ users: StaffUser[] }> = ({ users }) => {
  const children = useMemo(() => {
    const m = new Map<string | null, StaffUser[]>();
    for (const u of users) {
      const k = u.reportingManagerId && users.some((x) => x.id === u.reportingManagerId) ? u.reportingManagerId : null;
      m.set(k, [...(m.get(k) || []), u]);
    }
    return m;
  }, [users]);
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) || []).map((u) => (
      <div key={u.id}>
        <div className="py-1 text-[13px]" style={{ paddingLeft: depth * 20 }}>
          <span className="font-medium">{u.name || u.email}</span>{' '}
          <span className="text-[var(--text-tertiary)]">· {STAFF_ROLE_LABEL[u.role]}{u.status !== 'active' ? ' · suspended' : ''}</span>
        </div>
        {render(u.id, depth + 1)}
      </div>
    ));
  return <div>{render(null, 0)}</div>;
};

const AccessAudit: React.FC<{ users: StaffUser[] }> = ({ users }) => {
  const q = useQuery({ queryKey: ['staff_audit'], queryFn: staffApi.audit });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name || (id ? id.slice(0, 8) : '—');
  if (q.isLoading) return <TableSkeleton rows={5} cols={4} />;
  if (q.error) return <ErrorState message={`Could not load audit: ${(q.error as Error).message}`} />;
  return (
    <div className="overflow-x-auto border-y border-[var(--border)]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[var(--text-tertiary)]">
            {['When', 'Action', 'By', 'Target', 'Change'].map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {(q.data || []).map((e) => (
            <tr key={e.id}>
              <td className="py-2 pr-4 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
              <td className="py-2 pr-4"><Badge tone={e.action === 'denied' ? 'danger' : 'neutral'}>{e.action}</Badge></td>
              <td className="py-2 pr-4">{name(e.actor_id)} <span className="text-[var(--text-tertiary)]">{e.actor_role}</span></td>
              <td className="py-2 pr-4">{name(e.target_user_id)}</td>
              <td className="py-2 pr-4 max-w-[320px] truncate font-mono text-[11px]">
                {e.before != null ? `${JSON.stringify(e.before).slice(0, 60)} → ` : ''}
                {e.after != null ? JSON.stringify(e.after).slice(0, 80) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Team Access Matrix: Shows all team members side-by-side with their capability grants */
const TeamAccessMatrix: React.FC<{
  users: StaffUser[];
  deptName: (id: string | null) => string;
  onManageAccess: (u: StaffUser) => void;
}> = ({ users, deptName, onManageAccess }) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Team Access &amp; Capabilities Overview
          </h2>
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Review and adjust role grants, financials, and module scopes for every team member. Saved changes reflect immediately.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border-y border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[var(--text-tertiary)] bg-[var(--bg-subtle)]">
              <th className="py-2.5 px-3 font-semibold">Team Member</th>
              <th className="py-2.5 px-2 font-semibold">Role &amp; Department</th>
              <th className="py-2.5 px-2 font-semibold text-center">Business Dev</th>
              <th className="py-2.5 px-2 font-semibold text-center">Clients / Vendors</th>
              <th className="py-2.5 px-2 font-semibold text-center">Requirements</th>
              <th className="py-2.5 px-2 font-semibold text-center">Candidates &amp; Subs</th>
              <th className="py-2.5 px-2 font-semibold text-center">Interviews</th>
              <th className="py-2.5 px-2 font-semibold text-center">Financials &amp; Terms</th>
              <th className="py-2.5 px-2 font-semibold text-center">Reports</th>
              <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {users.map((u) => {
              const template = DEFAULT_TEMPLATES[u.role] || DEFAULT_TEMPLATES.recruiter;
              const hasFin = template.permissions.finance?.actions.length;
              const hasBD = template.permissions.business_development?.actions.length;
              const hasCV = template.permissions.clients_vendors?.actions.length;
              const hasReq = template.permissions.requirements?.actions.length;
              const hasCand = template.permissions.candidates?.actions.length;
              const hasInt = template.permissions.interviews?.actions.length;
              const hasRep = template.permissions.reports?.actions.length;

              return (
                <tr key={u.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-[var(--text-primary)]">{u.name || '—'}</div>
                    <div className="text-[11px] text-[var(--text-tertiary)]">{u.email}</div>
                  </td>
                  <td className="py-2.5 px-2">
                    <Badge tone={u.role === 'bdm' || u.role === 'senior_bom' ? 'info' : 'neutral'}>
                      {STAFF_ROLE_LABEL[u.role]}
                    </Badge>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      {deptName(u.departmentId)}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasBD ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasBD ? '✓ Active' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasCV ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasCV ? '✓ Active' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasReq ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasReq ? '✓ Active' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasCand ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasCand ? '✓ Active' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasInt ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasInt ? '✓ Active' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasFin ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasFin ? '✓ Edit & View' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className={hasRep ? 'text-emerald-600 font-bold' : 'text-slate-300'}>
                      {hasRep ? '✓ Export' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <Button size="sm" onClick={() => onManageAccess(u)}>
                      Customize
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** User Access Modal: Manage per-user permissions with immediate reflection */
const UserAccessModal: React.FC<{
  user: StaffUser;
  deptName: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ user, deptName, onClose, onSaved }) => {
  const { toast } = useToast();
  const baseTpl = DEFAULT_TEMPLATES[user.role] || DEFAULT_TEMPLATES.recruiter;
  const [draft, setDraft] = useState<PermissionSet>({ ...baseTpl.permissions });
  const [saving, setSaving] = useState(false);

  const toggle = (mod: (typeof PERMISSION_MODULES)[number], action: (typeof PERMISSION_ACTIONS)[number]) => {
    const cur = draft[mod] || { scope: 'organisation' as const, actions: [] };
    const actions = cur.actions.includes(action)
      ? cur.actions.filter((a) => a !== action)
      : [...cur.actions, action];
    setDraft({ ...draft, [mod]: { ...cur, actions } });
  };

  const setScope = (mod: (typeof PERMISSION_MODULES)[number], scope: (typeof RECORD_SCOPES)[number]) => {
    const cur = draft[mod] || { scope: 'organisation' as const, actions: [] };
    setDraft({ ...draft, [mod]: { ...cur, scope } });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await staffApi.updateUser(user.id, { permissionOverrides: draft });
      toast({
        title: 'Access saved and reflected',
        description: `Permissions for ${user.name || user.email} updated. Changes take effect immediately!`,
        tone: 'success',
      });
      onSaved();
    } catch (err) {
      toast({
        title: 'Could not save access',
        description: err instanceof Error ? err.message : 'Update failed',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title={`Manage Access: ${user.name || user.email}`}
      description={`${STAFF_ROLE_LABEL[user.role]} · Department: ${deptName}`}
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="p-3 rounded-[6px] border border-emerald-200 bg-emerald-50/60 text-[12px] text-emerald-800 flex items-start gap-2">
          <span className="font-bold text-[14px]">⚡</span>
          <div>
            <strong>Instant Reflection:</strong> Any changes saved here apply immediately to this employee's session across all modules, including financials, pipeline, and records.
          </div>
        </div>

        <div className="overflow-x-auto border-y border-[var(--border)]">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[var(--text-tertiary)] bg-[var(--bg-subtle)]">
                <th className="py-2 pr-3 font-medium">Module</th>
                <th className="py-2 pr-3 font-medium">Scope</th>
                {PERMISSION_ACTIONS.map((a) => (
                  <th key={a} className="py-2 px-1 font-medium capitalize text-center">
                    {a.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {PERMISSION_MODULES.map((mod) => (
                <tr key={mod}>
                  <td className="py-2 pr-3 font-medium">{MODULE_LABEL[mod]}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="bg-transparent border border-[var(--border)] rounded px-1 py-0.5 text-[11px]"
                      value={draft[mod]?.scope || 'organisation'}
                      onChange={(e) => setScope(mod, e.target.value as any)}
                    >
                      {RECORD_SCOPES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  {PERMISSION_ACTIONS.map((a) => (
                    <td key={a} className="py-2 px-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(draft[mod]?.actions.includes(a))}
                        onChange={() => toggle(mod, a)}
                        className="rounded border-[var(--border)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Save Access &amp; Reflect Immediately
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
