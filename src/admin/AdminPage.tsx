import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Loader2, Crown, Users2, Shield, GripVertical, Printer } from 'lucide-react';
import AdminTopbar from '@/admin/AdminTopbar';
import BorderGlow from '@/components/BorderGlow';
import { supabase as supabaseRef } from '@/lib/supabase';
import { resolveAsset } from '@/lib/base';
import { useTheme } from '@/lib/useTheme';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import DashboardTab from '@/admin/DashboardTab';
import SessionsTab from '@/admin/SessionsTab';
import ActivityTab from '@/admin/ActivityTab';
import PlayersTab from '@/admin/PlayersTab';
import WorkflowTab from '@/admin/WorkflowTab';
import { EmailTestCard } from '@/admin/EmailTestCard';
import {
  fetchAdminTeams,
  fetchAdminPlayers,
  fetchPendingEdits,
  isCurrentUserAdmin,
  getCurrentUserEmail,
  signInAdmin,
  signOutAdmin,
  adminSaveSettings,
  adminUpsertTeam,
  adminDeleteTeam,
  logAudit,
  type AdminTeam,
  type AdminPlayer,
} from '@/lib/site';

const THEME_CHOICES = ['kings', 'mavale', 'mitra', 'blaster', 'dhada', 'wala', 'titans', 'yodhas', 'gallit', 'dhurandhars'];
const SQUAD_SIZE = 11;

function toLocal(dt: string | null | undefined): string {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const settingsSchema = z.object({
  registration_open: z.string(),
  registration_deadline: z.string(),
  player_capacity: z.string().regex(/^\d+$/, 'Must be a number.'),
  total_teams: z.string().regex(/^\d+$/, 'Must be a number.'),
  total_matches: z.string().regex(/^\d+$/, 'Must be a number.'),
  champion: z.string(),
});

type SettingsValues = z.infer<typeof settingsSchema>;

const TAB_KEYS = ['dashboard', 'sessions', 'activity', 'settings', 'teams', 'players', 'workflow'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function AdminPage() {
  const { dark, toggleTheme } = useTheme();
  const [phase, setPhase] = useState<'checking' | 'anon' | 'admin' | 'denied'>('checking');
  const [tabOrder, setTabOrder] = useState<TabKey[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dpl-admin-tab-order') ?? 'null');
      if (Array.isArray(saved) && saved.length === TAB_KEYS.length && saved.every((key) => (TAB_KEYS as readonly string[]).includes(key))) return saved as TabKey[];
    } catch {
      /* corrupted order — fall back to default */
    }
    return [...TAB_KEYS];
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [playersPreset, setPlayersPreset] = useState<{ photo?: boolean; unassigned?: boolean } | null>(null);
  const [pendingEdits, setPendingEdits] = useState(0);
  const [anomalies, setAnomalies] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetchPendingEdits().then((rows) => { if (alive) setPendingEdits(rows.length); });
    load();
    const id = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      supabaseRef!.rpc('admin_anomaly_counts').then(({ data, error }) => {
        if (error || !data || !data[0] || !alive) return;
        setAnomalies(Number(data[0].flagged_registrations ?? 0) + Number(data[0].flagged_requests ?? 0));
      });
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (typing) return;
      const index = Number(event.key);
      if (index >= 1 && index <= TAB_KEYS.length) {
        setTab(TAB_KEYS[index - 1]);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        document.getElementById('players-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const moveTab = (from: number, to: number) => {
    if (from === to) return;
    setTabOrder((order) => {
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      localStorage.setItem('dpl-admin-tab-order', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const userEmail = await getCurrentUserEmail();
      if (!userEmail) {
        if (alive) setPhase('anon');
        return;
      }
      const admin = await isCurrentUserAdmin();
      if (!alive) return;
      setPhase(admin ? 'admin' : 'denied');
    })();
    return () => { alive = false; };
  }, []);

  const handleLogout = async () => {
    await signOutAdmin();
    setPhase('anon');
  };

  if (phase === 'checking') {
    return (
      <div className={dark ? 'app dark admin-page relative isolate' : 'app admin-page relative isolate'}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="admin-main shell">
          <div className="flex items-center justify-center gap-3 py-16 text-sm font-semibold text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> CHECKING…
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'anon') {
    return (
      <div className={dark ? 'app dark admin-page relative isolate' : 'app admin-page relative isolate'}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-10">
          <BorderGlow className="w-full max-w-sm" backgroundColor="#0b1420" colors={['#09c9d8', '#873cff', '#2f7dff']} glowColor="196 100 48" glowIntensity={1.05} glowRadius={26} edgeSensitivity={24} borderRadius={18}>
            <LoginForm onSuccess={async () => setPhase((await isCurrentUserAdmin()) ? 'admin' : 'denied')} />
          </BorderGlow>
        </main>
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className={dark ? 'app dark admin-page relative isolate' : 'app admin-page relative isolate'}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="admin-main shell">
          <div className="admin-denied">
            <div className="admin-login-icon">🔒</div>
            <h1>NOT AUTHORIZED</h1>
            <p>This account isn&apos;t on the admin whitelist.</p>
            <Button variant="outline" type="button" onClick={handleLogout}>SIGN OUT</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={dark ? 'app dark admin-page relative isolate' : 'app admin-page relative isolate'}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={phase === 'admin'} />
      <main className="admin-main shell">
        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <TabsList>
              {tabOrder.map((tab, index) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className={dragIndex === index ? 'opacity-40' : ''}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) moveTab(dragIndex, index);
                    setDragIndex(null);
                  }}
                >
                  <span
                    draggable
                    title="Drag to reorder"
                    className="cursor-grab opacity-50 hover:opacity-100 active:cursor-grabbing"
                    onDragStart={() => { setDragIndex(index); }}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <GripVertical />
                  </span>
                  {tab.toUpperCase()}
                  {tab === 'workflow' && pendingEdits > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
                      {pendingEdits}
                    </span>
                  )}
                  {tab === 'activity' && anomalies > 0 && (
                    <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {anomalies}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <CompletionChip
              onUnassigned={() => { setTab('players'); setPlayersPreset({ unassigned: true }); }}
              onNoPhoto={() => { setTab('players'); setPlayersPreset({ photo: true }); }}
            />
          </div>
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="sessions">
            <SessionsTab />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
          <TabsContent value="players">
            <PlayersTab preset={playersPreset} onPresetApplied={() => setPlayersPreset(null)} />
          </TabsContent>
          <TabsContent value="workflow">
            <WorkflowTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function CompletionChip({ onUnassigned, onNoPhoto }: { onUnassigned: () => void; onNoPhoto: () => void }) {
  const [counts, setCounts] = useState<{ unassigned: number; noPhoto: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchAdminPlayers().then((rows) => {
        if (!alive) return;
        setCounts({
          unassigned: rows.filter((player) => !player.team_id).length,
          noPhoto: rows.filter((player) => !player.photo_url).length,
        });
      });
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  if (!counts) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onUnassigned}>
        <Users2 className="size-3.5" /> {counts.unassigned} UNASSIGNED
      </Button>
      <Button variant="outline" size="sm" onClick={onNoPhoto}>
        <Shield className="size-3.5" /> {counts.noPhoto} NO PHOTO
      </Button>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: signInError } = await signInAdmin(email.trim(), password);
    setBusy(false);
    if (signInError) {
      setError(signInError);
      return;
    }
    onSuccess();
  };

  return (
    <Card className="w-full max-w-sm border-border/60 shadow-2xl">
      <CardHeader className="justify-items-center pb-2 pt-8 text-center">
        <div className="mb-2 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white shadow-lg">
          <Shield />
        </div>
        <CardTitle className="text-xl font-black tracking-wide">ADMIN ACCESS</CardTitle>
        <CardDescription>Sign in with your Supabase Auth account to manage DPL 2026.</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-7">
        <form onSubmit={handleLogin} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="admin-email">EMAIL</Label>
            <Input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="admin-password">PASSWORD</Label>
            <Input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </div>
          )}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? 'SIGNING IN…' : 'SIGN IN'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SettingsTab() {
  const [loading, setLoading] = useState(true);
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      registration_open: '',
      registration_deadline: '',
      player_capacity: '128',
      total_teams: '16',
      total_matches: '24',
      champion: '',
    },
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseRef!.from('settings').select('*').single();
      if (!alive || !data) return;
      form.reset({
        registration_open: toLocal(data.registration_open),
        registration_deadline: toLocal(data.registration_deadline),
        player_capacity: String(data.player_capacity ?? 128),
        total_teams: String(data.total_teams ?? 16),
        total_matches: String(data.total_matches ?? 24),
        champion: data.champion ?? '',
      });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [form]);

  const save = async (values: SettingsValues) => {
    const { error } = await adminSaveSettings({
      registration_open: values.registration_open ? new Date(values.registration_open).toISOString() : null,
      registration_deadline: values.registration_deadline ? new Date(values.registration_deadline).toISOString() : null,
      player_capacity: Number(values.player_capacity),
      total_teams: Number(values.total_teams),
      total_matches: Number(values.total_matches),
      champion: values.champion || null,
    });
    if (error) toast.error(`Failed: ${error}`);
    else {
      toast.success('Settings saved.');
      void logAudit('settings.update', null, { values });
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(save)} className="space-y-6">
          <div>
            <h2 className="mb-4 font-display text-xl font-bold tracking-wide">REGISTRATION TIMING</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="registration_open" render={({ field }) => (
                <FormItem>
                  <FormLabel>OPENING</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="registration_deadline" render={({ field }) => (
                <FormItem>
                  <FormLabel>DEADLINE</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
          <div>
            <h2 className="mb-4 font-display text-xl font-bold tracking-wide">COUNTS</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField control={form.control} name="player_capacity" render={({ field }) => (
                <FormItem>
                  <FormLabel>PLAYER CAPACITY</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="total_teams" render={({ field }) => (
                <FormItem>
                  <FormLabel>TOTAL TEAMS</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="total_matches" render={({ field }) => (
                <FormItem>
                  <FormLabel>TOTAL MATCHES</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="champion" render={({ field }) => (
                <FormItem>
                  <FormLabel>CHAMPION LABEL</FormLabel>
                  <FormControl><Input placeholder="e.g. 1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {form.formState.isSubmitting ? 'SAVING…' : 'SAVE SETTINGS'}
          </Button>
        </form>
      </Form>
      <div className="mt-8">
        <EmailTestCard />
      </div>
    </div>
  );
}

function TeamsTab() {
  const [teams, setTeams] = useState<AdminTeam[] | null>(null);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [editing, setEditing] = useState<AdminTeam | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<AdminTeam | null>(null);
  const [squadTeam, setSquadTeam] = useState<AdminTeam | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fetchAdminTeams().then(setTeams);
    fetchAdminPlayers().then(setPlayers);
  };

  useEffect(reload, []);

  const empty: AdminTeam = { id: '', name: '', icon: '', code: '', icon_url: '/D2P/teams/', theme: '', owner: '', captain: '', champion: false, sort_order: (teams?.length ?? 0) + 1 };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    const payload = {
      name: editing.name.trim(),
      code: (editing.code ?? '').trim().toUpperCase(),
      icon_url: editing.icon_url.trim(),
      theme: editing.theme.trim(),
      owner: editing.owner ?? '',
      captain: editing.captain ?? '',
      champion: editing.champion,
      sort_order: editing.sort_order,
    };
    const { error } = await adminUpsertTeam(editing.id ? { ...payload, id: editing.id } : { ...payload, id: undefined });
    setBusy(false);
    if (error) {
      toast.error(`Failed: ${error}`);
      return;
    }
    toast.success('Team saved.');
    setEditing(null);
    reload();
  };

  const remove = async () => {
    if (!teamToDelete) return;
    setBusy(true);
    const { error } = await adminDeleteTeam(teamToDelete.id);
    setBusy(false);
    setTeamToDelete(null);
    if (error) {
      toast.error(`Failed: ${error}`);
      return;
    }
    toast.success('Team deleted.');
    reload();
  };

  const printRoster = (team: AdminTeam) => {
    const members = players
      .filter((player) => player.team_id === team.id)
      .sort((a, b) => {
        const rank = { captain: 0, vice_captain: 1, player: 2 };
        return (rank[a.role as keyof typeof rank] ?? 2) - (rank[b.role as keyof typeof rank] ?? 2) || a.name.localeCompare(b.name);
      });
    const win = window.open('', '_blank', 'width=780,height=920');
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups for this site to print.');
      return;
    }
    const rows = members.length
      ? members.map((player, index) => {
          const role = player.role === 'captain' ? 'CAPTAIN' : player.role === 'vice_captain' ? 'VICE CAPTAIN' : 'PLAYER';
          return `<tr>
            <td class="num">${index + 1}</td>
            <td><strong>${player.name}</strong><br/><span class="sub">${player.location || '—'} · ${player.player_type || '—'}</span></td>
            <td class="role">${role}</td>
            <td class="num">${player.self_rating ? '★'.repeat(player.self_rating) : '—'}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="empty">No players assigned yet.</td></tr>';
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${team.name} — DPL 2026 Roster</title><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #0f172a; padding: 32px; }
      .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
      h1 { font-size: 22px; letter-spacing: 1px; text-transform: uppercase; }
      .code { font-size: 14px; font-weight: 700; color: #475569; }
      .meta { display: flex; justify-content: space-between; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 6px 8px; }
      td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      .num { text-align: center; width: 34px; color: #64748b; }
      .role { white-space: nowrap; font-weight: 600; }
      .sub { font-size: 11px; color: #64748b; }
      .empty { text-align: center; color: #94a3b8; padding: 24px; }
      .foot { margin-top: 22px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
    </style></head><body>
      <div class="head">
        <div><h1>${team.name.toUpperCase()}</h1><div class="code">${team.code} · ${team.theme || ''}</div></div>
        <div style="text-align:right"><h1>DPL 2026</h1><div class="code">SQUAD ROSTER</div></div>
      </div>
      <div class="meta"><span>${members.length} players · squad size ${SQUAD_SIZE}</span><span>Printed ${new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
      <table>
        <thead><tr><th>#</th><th>PLAYER</th><th>ROLE</th><th>RATING</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="foot">${team.champion ? 'Defending champions' : 'DPL 2026'} · DPL Cricket League</div>
    </body></html>`);
    win.document.close();
    win.focus();
    win.onload = () => setTimeout(() => win.print(), 150);
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold tracking-wide">TEAMS</h2>
        <Button size="sm" onClick={() => setEditing(empty)}><Plus /> ADD TEAM</Button>
      </div>

      {!teams ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((row) => <Skeleton key={row} className="h-12 w-full" />)}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">ICON</TableHead>
              <TableHead>NAME</TableHead>
              <TableHead>DETAILS</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead>SQUAD</TableHead>
              <TableHead className="text-right">ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No teams yet — add the first one.</TableCell>
              </TableRow>
            )}
            {teams.map((team) => (
              <TableRow key={team.id}>
                <TableCell>
                  {team.icon_url ? <img src={resolveAsset(team.icon_url)} alt="" className="h-12 w-9 rounded object-cover" /> : <div className="h-12 w-9 rounded bg-muted" />}
                </TableCell>
                <TableCell className="font-medium">{team.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {[team.code, team.theme, team.owner && `owner: ${team.owner}`, team.captain && `captain: ${team.captain}`, `${players.filter((player) => player.team_id === team.id).length} players`].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell>
                  {team.champion ? <Badge variant="default" className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15"><Crown /> CHAMPION</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {(() => {
                    const squadSize = players.filter((player) => player.team_id === team.id).length;
                    if (squadSize > SQUAD_SIZE) return <Badge variant="default" className="bg-destructive/15 text-destructive hover:bg-destructive/15">{squadSize}/{SQUAD_SIZE} OVER</Badge>;
                    if (squadSize < SQUAD_SIZE) return <Badge variant="default" className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">{squadSize}/{SQUAD_SIZE} SHORT</Badge>;
                    return <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">{squadSize}/{SQUAD_SIZE} FULL</Badge>;
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSquadTeam(team)}><Users2 /> SQUAD</Button>
                    <Button variant="outline" size="sm" onClick={() => setEditing(team)}><Pencil /> EDIT</Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setTeamToDelete(team)}><Trash2 /> DELETE</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? `EDIT ${editing?.name.toUpperCase()}` : 'NEW TEAM'}</DialogTitle>
            <DialogDescription>Team details are shown on the teams page and auction screen.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="team-name">NAME</Label>
                  <Input id="team-name" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="team-code">CODE</Label>
                  <Input id="team-code" required value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="team-icon">ICON URL</Label>
                  <Input id="team-icon" value={editing.icon_url} onChange={(e) => setEditing({ ...editing, icon_url: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="team-theme">THEME</Label>
                  <Select value={editing.theme} onValueChange={(theme) => setEditing({ ...editing, theme })}>
                    <SelectTrigger id="team-theme" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {THEME_CHOICES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="team-order">SORT ORDER</Label>
                  <Input id="team-order" type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="team-owner">OWNER</Label>
                  <Input id="team-owner" value={editing.owner ?? ''} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="team-captain">CAPTAIN</Label>
                  <Input id="team-captain" value={editing.captain ?? ''} onChange={(e) => setEditing({ ...editing, captain: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={editing.champion} onChange={(e) => setEditing({ ...editing, champion: e.target.checked })} />
                CHAMPIONS
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>CANCEL</Button>
                <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} SAVE</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!teamToDelete} onOpenChange={(open) => { if (!open) setTeamToDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DELETE {teamToDelete?.name.toUpperCase()}?</DialogTitle>
            <DialogDescription>This removes the team and all of its player mappings. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeamToDelete(null)}>CANCEL</Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>{busy && <Loader2 className="animate-spin" />} DELETE</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!squadTeam} onOpenChange={(open) => { if (!open) setSquadTeam(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{squadTeam?.name.toUpperCase()} SQUAD</DialogTitle>
            <DialogDescription>{squadTeam?.code} · {players.filter((player) => player.team_id === squadTeam?.id).length} players</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => squadTeam && printRoster(squadTeam)}><Printer /> PRINT ROSTER</Button>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {(() => {
              const members = players
                .filter((player) => player.team_id === squadTeam?.id)
                .sort((a, b) => {
                  const rank = { captain: 0, vice_captain: 1, player: 2 };
                  return (rank[a.role as keyof typeof rank] ?? 2) - (rank[b.role as keyof typeof rank] ?? 2) || a.name.localeCompare(b.name);
                });
              if (!members.length) {
                return <p className="py-8 text-center text-sm text-muted-foreground">No players assigned yet.</p>;
              }
              return members.map((player) => (
                <div key={player.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  {player.photo_url
                    ? <img src={player.photo_url} alt="" className="size-8 rounded-full object-cover" loading="lazy" decoding="async" />
                    : <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-[10px] font-bold text-primary">{player.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'}</div>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{player.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{player.location} · {player.player_type}</div>
                  </div>
                  {player.role === 'captain'
                    ? <Badge variant="secondary"><Shield /> CAPTAIN</Badge>
                    : player.role === 'vice_captain'
                      ? <Badge variant="secondary"><Shield /> VC</Badge>
                      : <Badge variant="outline">PLAYER</Badge>}
                </div>
              ));
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
