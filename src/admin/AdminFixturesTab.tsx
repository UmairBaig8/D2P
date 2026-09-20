import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, EyeOff, FileDown, History, Loader2, Lock, Pencil, Pin, PinOff, Plus, Printer, RotateCcw, Target, Trash2, Unlock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AdminScorerDialog from '@/admin/AdminScorerDialog';
import { fetchTeamRoster, fetchTeamsList, logAudit, type TeamRow } from '@/lib/site';
import {
  adminFixtureBulkStatus, adminFixtureCreate, adminFixtureDelete, adminFixtureReorder,
  adminFixtureReset, adminFixtureRestore, adminFixtureUpdate, computeStandings, fetchFixtureConfig,
  fetchFixtures, fetchFixtureHistory, fetchMatchPom, formatFixtureDate, formatFixtureTime, oversText,
  DEFAULT_FIXTURE_CONFIG,
  type Fixture, type FixtureConfig, type FixtureHistoryRow, type FixtureResultType, type FixtureStage, type FixtureStatus,
} from '@/lib/fixtures';

const STATUSES: FixtureStatus[] = ['upcoming', 'live', 'completed', 'postponed'];
const RESULTS: FixtureResultType[] = ['normal', 'tie', 'no_result', 'abandoned', 'forfeit'];
const STAGES: FixtureStage[] = ['league', 'semifinal', 'final'];
const STATUS_TONE: Record<FixtureStatus, string> = {
  upcoming: 'bg-cyan-500/15 text-cyan-600 hover:bg-cyan-500/15',
  live: 'bg-pink-500/15 text-pink-600 hover:bg-pink-500/15',
  completed: 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15',
  postponed: 'bg-slate-500/15 text-slate-500 hover:bg-slate-500/15',
};

type FormState = {
  match_date: string; match_time: string; venue: string; status: FixtureStatus;
  home_code: string; away_code: string;
  home_score: string; away_score: string; home_overs: string; away_overs: string;
  result_type: FixtureResultType; winner_code: string; points_home: string; points_away: string;
  note: string; published: boolean; pinned: boolean; player_of_match: string;
};

function toForm(f: Fixture): FormState {
  return {
    match_date: f.match_date, match_time: f.match_time.slice(0, 5), venue: f.venue, status: f.status,
    home_code: f.home_code, away_code: f.away_code,
    home_score: f.home_score == null ? '' : String(f.home_score),
    away_score: f.away_score == null ? '' : String(f.away_score),
    home_overs: f.home_overs == null ? '' : String(f.home_overs),
    away_overs: f.away_overs == null ? '' : String(f.away_overs),
    result_type: f.result_type, winner_code: f.winner_code ?? '',
    points_home: f.points_home == null ? '' : String(f.points_home),
    points_away: f.points_away == null ? '' : String(f.points_away),
    note: f.note ?? '', published: f.published, pinned: f.pinned, player_of_match: f.player_of_match ?? '',
  };
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function csvRow(cells: Array<string | number | boolean | null>): string {
  return cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

export default function AdminFixturesTab() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [config, setConfig] = useState<FixtureConfig>(DEFAULT_FIXTURE_CONFIG);
  const [editing, setEditing] = useState<Fixture | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Fixture | null>(null);
  const [scoring, setScoring] = useState<Fixture | null>(null);
  const [history, setHistory] = useState<Fixture | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fetchFixtures().then(({ data }) => setFixtures(data));
    fetchTeamsList().then(setTeams);
    fetchFixtureConfig().then(setConfig);
  };
  useEffect(reload, []);

  const ordered = useMemo(() => [...(fixtures ?? [])].sort((a, b) => a.sort_order - b.sort_order), [fixtures]);

  const move = async (matchNumber: number, dir: -1 | 1) => {
    const list = [...ordered];
    const i = list.findIndex((f) => f.match_number === matchNumber);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const { error } = await adminFixtureReorder(list.map((f) => f.match_number));
    if (error) return toast.error(`Reorder failed: ${error}`);
    void logAudit('fixture.reorder', String(matchNumber), { direction: dir });
    reload();
  };

  const quick = async (f: Fixture, patch: Record<string, unknown>, action: string) => {
    const { error } = await adminFixtureUpdate(f.match_number, patch);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit(`fixture.${action}`, String(f.match_number), patch);
    toast.success(`Match ${f.match_number} updated.`);
    reload();
  };

  const complete = async (f: Fixture) => {
    if (f.home_score == null && f.away_score == null && !window.confirm(`Match ${f.match_number} has no scores entered. Mark it completed anyway?`)) return;
    await quick(f, { status: 'completed' }, 'complete');
  };

  const reset = async (f: Fixture) => {
    if (!window.confirm(`Reset match ${f.match_number}? Scores, winner and points are cleared.`)) return;
    const { error } = await adminFixtureReset(f.match_number);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit('fixture.reset', String(f.match_number), {});
    toast.success(`Match ${f.match_number} reset.`);
    reload();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await adminFixtureDelete(deleting.match_number);
    setBusy(false);
    setDeleting(null);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit('fixture.delete', String(deleting.match_number), {});
    toast.success('Match deleted.');
    reload();
  };

  const bulk = async (status: FixtureStatus, day?: string) => {
    const matches = ordered.filter((f) => !day || f.match_date === day).map((f) => f.match_number);
    if (!matches.length) return;
    if (status === 'completed' && !window.confirm(`Mark ${matches.length} match(es) completed? Matches without scores will have no result.`)) return;
    const { error } = await adminFixtureBulkStatus(matches, status);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit('fixture.bulk_status', null, { status, day: day ?? 'all', matches: matches.length });
    toast.success(`${matches.length} match(es) → ${status}.`);
    reload();
  };

  const groups = useMemo(() => {
    const g: Record<'A' | 'B', string[]> = { A: [], B: [] };
    (fixtures ?? []).forEach((f) => {
      if (f.stage !== 'league' || (f.group_name !== 'A' && f.group_name !== 'B')) return;
      [f.home_code, f.away_code].forEach((c) => { if (!g[f.group_name as 'A' | 'B'].includes(c)) g[f.group_name as 'A' | 'B'].push(c); });
    });
    return g;
  }, [fixtures]);

  const tables = useMemo(() => ({
    A: computeStandings(fixtures ?? [], teams, groups.A, config),
    B: computeStandings(fixtures ?? [], teams, groups.B, config),
  }), [fixtures, teams, groups, config]);

  const insights = useMemo(() => {
    const done = (fixtures ?? []).filter((f) => f.status === 'completed');
    const scores = done.flatMap((f) => [f.home_score, f.away_score]).filter((n): n is number => n != null);
    const margins = done.map((f) => (f.home_score != null && f.away_score != null ? Math.abs(f.home_score - f.away_score) : null)).filter((n): n is number => n != null);
    const best = [...tables.A, ...tables.B].sort((a, b) => b.nrr - a.nrr)[0];
    return {
      completed: done.length,
      total: (fixtures ?? []).length,
      highest: scores.length ? Math.max(...scores) : null,
      biggest: margins.length ? Math.max(...margins) : null,
      best,
    };
  }, [fixtures, tables]);

  const exportCsv = () => {
    const header = ['match', 'stage', 'group', 'date', 'time', 'venue', 'home', 'away', 'home_score', 'away_score', 'home_overs', 'away_overs', 'winner', 'status', 'result_type', 'points_home', 'points_away', 'note', 'published', 'locked'];
    const lines = [csvRow(header), ...ordered.map((f) => csvRow([f.match_number, f.stage, f.group_name, f.match_date, f.match_time, f.venue, f.home_code, f.away_code, f.home_score, f.away_score, f.home_overs, f.away_overs, f.winner_code, f.status, f.result_type, f.points_home, f.points_away, f.note, f.published, f.locked]))];
    download('dpl-2026-fixtures.csv', lines.join('\n'));
  };

  const exportStandings = () => {
    const header = ['group', 'rank', 'team', 'played', 'won', 'lost', 'tied', 'points', 'nrr'];
    const rows = [...tables.A.map((r, i) => ['A', i + 1, r.team.name, r.played, r.won, r.lost, r.tied, r.points, r.nrr]), ...tables.B.map((r, i) => ['B', i + 1, r.team.name, r.played, r.won, r.lost, r.tied, r.points, r.nrr])];
    download('dpl-2026-standings.csv', [csvRow(header), ...rows.map((r) => csvRow(r))].join('\n'));
  };

  const printAll = () => {
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return toast.error('Pop-up blocked — allow pop-ups to print.');
    const rows = ordered.map((f) => `<tr><td>${f.match_number}</td><td>${f.stage}${f.group_name ? ` ${f.group_name}` : ''}</td><td>${f.match_date} ${formatFixtureTime(f.match_time)}</td><td>${f.venue}</td><td>${f.home_code} vs ${f.away_code}</td><td>${f.home_score ?? '—'} – ${f.away_score ?? '—'}</td><td>${f.winner_code ?? '—'}</td><td>${f.status}</td></tr>`).join('');
    const table = (name: string, rows2: ReturnType<typeof computeStandings>) => `<h3>${name}</h3><table><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th></tr></thead><tbody>${rows2.map((r, i) => `<tr><td>${i + 1}</td><td>${r.team.code} ${r.team.name}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.points}</td><td>${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(3)}</td></tr>`).join('')}</tbody></table>`;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>DPL 2026 — Fixtures</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:28px;color:#0f172a}h1{font-size:22px;margin:0 0 4px}h3{font-size:14px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:1px;color:#475569}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px}th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#64748b;border-bottom:1px solid #cbd5e1;padding:5px 6px}td{padding:5px 6px;border-bottom:1px solid #e2e8f0}.meta{color:#64748b;font-size:11px;margin-bottom:14px}</style></head><body><h1>DPL 2026 — Fixtures &amp; Standings</h1><div class="meta">Printed ${new Date().toLocaleString()}</div>${table('Group A', tables.A)}${table('Group B', tables.B)}<h3>Fixtures</h3><table><thead><tr><th>#</th><th>Stage</th><th>Date</th><th>Venue</th><th>Fixture</th><th>Score</th><th>Winner</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.onload = () => setTimeout(() => win.print(), 200);
  };

  if (!fixtures) {
    return <div className="space-y-2 rounded-xl border bg-card p-6 shadow-sm">{[1, 2, 3, 4, 5, 6].map((r) => <Skeleton key={r} className="h-11 w-full" />)}</div>;
  }

  const days = [...new Set(ordered.map((f) => f.match_date))].sort();

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Insight label="MATCHES COMPLETED" value={`${insights.completed}/${insights.total}`} />
        <Insight label="HIGHEST TOTAL" value={insights.highest == null ? '—' : String(insights.highest)} />
        <Insight label="BIGGEST MARGIN" value={insights.biggest == null ? '—' : `${insights.biggest} runs`} />
        <Insight label="BEST NRR" value={insights.best ? `${insights.best.team.code} ${insights.best.nrr > 0 ? '+' : ''}${insights.best.nrr.toFixed(3)}` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StandingsCard name="GROUP A" rows={tables.A} />
        <StandingsCard name="GROUP B" rows={tables.B} />
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-wide">FIXTURES</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value="__" onValueChange={(v) => bulk(v as FixtureStatus)}>
              <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="BULK STATUS (ALL)" /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>Mark all → {s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv}><FileDown /> CSV</Button>
            <Button variant="outline" size="sm" onClick={exportStandings}><FileDown /> STANDINGS</Button>
            <Button variant="outline" size="sm" onClick={printAll}><Printer /> PRINT</Button>
            <Button size="sm" onClick={() => setCreating(true)}><Plus /> ADD MATCH</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ORDER</TableHead>
                <TableHead className="w-24">MATCH</TableHead>
                <TableHead>DATE · TIME</TableHead>
                <TableHead>FIXTURE</TableHead>
                <TableHead className="w-28">SCORE</TableHead>
                <TableHead className="w-28">STATUS</TableHead>
                <TableHead className="w-20">PUB</TableHead>
                <TableHead className="text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((f) => {
                const home = teams.find((t) => t.code === f.home_code);
                const away = teams.find((t) => t.code === f.away_code);
                return (
                  <TableRow key={f.id} className={f.locked ? 'opacity-70' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={f.sort_order === ordered[0]?.sort_order} onClick={() => move(f.match_number, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                        <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={f.sort_order === ordered[ordered.length - 1]?.sort_order} onClick={() => move(f.match_number, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      M{f.match_number} {f.locked && <Lock className="ml-1 inline size-3 text-amber-500" />}{f.pinned && <Pin className="ml-1 inline size-3 text-cyan-500" />}
                      <span className="block text-[10px] uppercase text-muted-foreground">{f.stage === 'league' ? (f.group_name ? `Grp ${f.group_name}` : 'Cross') : f.stage}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-semibold">{formatFixtureDate(f.match_date)}</span>
                      <span className="block text-muted-foreground">{formatFixtureTime(f.match_time)} · {f.venue}</span>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {home?.code ?? f.home_code} <span className="text-muted-foreground">vs</span> {away?.code ?? f.away_code}
                      {f.note && <span className="block text-[10px] italic text-muted-foreground">{f.note}</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {f.home_score == null && f.away_score == null
                        ? <span className="text-muted-foreground">—</span>
                        : <span className="font-semibold">{f.home_score ?? '—'} – {f.away_score ?? '—'}</span>}
                      {(f.home_overs != null || f.away_overs != null) && <span className="block text-[10px] text-muted-foreground">{oversText(f.home_overs)} / {oversText(f.away_overs)} ov</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" className={STATUS_TONE[f.status]}>{f.status}</Badge>
                      {f.result_type !== 'normal' && <span className="mt-1 block text-[10px] uppercase text-muted-foreground">{f.result_type.replace('_', ' ')}</span>}
                    </TableCell>
                    <TableCell>
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => quick(f, { published: !f.published }, 'publish')} aria-label="Toggle published">
                        {f.published ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setScoring(f)} title="Ball-by-ball scorer"><Target /> SCORE</Button>
                        <Button variant="outline" size="sm" onClick={() => quick(f, { status: 'live' }, 'live')}><Zap /> LIVE</Button>
                        <Button variant="outline" size="sm" onClick={() => complete(f)}>DONE</Button>
                        <Button variant="outline" size="sm" disabled={f.locked} onClick={() => setEditing(f)}><Pencil /> EDIT</Button>
                        <Button variant="outline" size="sm" onClick={() => setHistory(f)} title="History"><History /></Button>
                        <Button variant="outline" size="sm" className={f.pinned ? 'text-cyan-600' : ''} onClick={() => quick(f, { pinned: !f.pinned }, f.pinned ? 'unpin' : 'pin')} title={f.pinned ? 'Unpin teams' : 'Pin teams'}>{f.pinned ? <Pin /> : <PinOff />}</Button>
                        <Button variant="outline" size="sm" className={f.locked ? 'text-amber-600' : ''} onClick={() => quick(f, { locked: !f.locked }, f.locked ? 'unlock' : 'lock')} title={f.locked ? 'Unlock' : 'Lock'}>{f.locked ? <Unlock /> : <Lock />}</Button>
                        <Button variant="outline" size="sm" onClick={() => reset(f)}><RotateCcw /></Button>
                        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleting(f)}><Trash2 /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!ordered.length && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No fixtures yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Bulk by day:</span>
          {days.map((d) => (
            <div key={d} className="flex items-center gap-1 rounded-lg border px-2 py-1">
              <span className="text-xs font-semibold">{formatFixtureDate(d)}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => bulk('live', d)}>LIVE</Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => bulk('completed', d)}>DONE</Button>
            </div>
          ))}
        </div>
      </div>

      {editing && <EditDialog fixture={editing} teams={teams} onClose={() => setEditing(null)} onSaved={reload} />}
      {creating && <CreateDialog teams={teams} days={days} onClose={() => setCreating(false)} onSaved={reload} />}
      {scoring && <AdminScorerDialog fixture={scoring} onClose={() => setScoring(null)} onSaved={reload} />}
      {history && <HistoryDialog fixture={history} onClose={() => setHistory(null)} onRestored={reload} />}

      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DELETE MATCH {deleting?.match_number}?</DialogTitle>
            <DialogDescription>This permanently removes the fixture. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>CANCEL</Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>{busy && <Loader2 className="animate-spin" />} DELETE</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 font-display text-2xl font-bold">{value}</div></div>;
}

function StandingsCard({ name, rows }: { name: string; rows: ReturnType<typeof computeStandings> }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="border-b px-4 py-3 font-display text-lg font-bold tracking-wide">{name}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>TEAM</TableHead>
            <TableHead className="w-10 text-center">P</TableHead>
            <TableHead className="w-10 text-center">W</TableHead>
            <TableHead className="w-10 text-center">L</TableHead>
            <TableHead className="w-14 text-center">PTS</TableHead>
            <TableHead className="w-16 text-right">NRR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.team.id} className={i < 2 ? 'bg-cyan-500/5' : ''}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-semibold">{r.team.code} <span className="text-xs font-normal text-muted-foreground">{r.team.name}</span></TableCell>
              <TableCell className="text-center">{r.played}</TableCell>
              <TableCell className="text-center text-emerald-600">{r.won}</TableCell>
              <TableCell className="text-center text-pink-600">{r.lost}</TableCell>
              <TableCell className="text-center font-bold">{r.points}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.played ? `${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(3)}` : '—'}</TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No teams.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function HistoryDialog({ fixture, onClose, onRestored }: { fixture: Fixture; onClose: () => void; onRestored: () => void }) {
  const [rows, setRows] = useState<FixtureHistoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetchFixtureHistory(fixture.match_number).then(setRows);
  useEffect(() => {
    let alive = true;
    fetchFixtureHistory(fixture.match_number).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [fixture.match_number]);

  const restore = async (id: number) => {
    if (!window.confirm('Restore this snapshot? Current values will be replaced.')) return;
    setBusy(true);
    const { error } = await adminFixtureRestore(id);
    setBusy(false);
    if (error) return toast.error(error);
    void logAudit('fixture.restore', String(fixture.match_number), { history_id: id });
    toast.success('Snapshot restored.');
    onRestored();
    load();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>HISTORY · M{fixture.match_number} {fixture.home_code} vs {fixture.away_code}</DialogTitle>
          <DialogDescription>Every change is snapshotted. Restore any row to undo.</DialogDescription>
        </DialogHeader>
        {!rows && <div className="grid place-items-center py-8"><Loader2 className="animate-spin" /></div>}
        {rows && !rows.length && <p className="py-6 text-center text-sm text-muted-foreground">No history yet.</p>}
        <div className="space-y-2">
          {(rows ?? []).map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">{h.home_code} vs {h.away_code} <span className="font-normal text-muted-foreground">· {h.home_score ?? '—'}–{h.away_score ?? '—'} · {h.status}</span></div>
                <div className="text-[10px] uppercase text-muted-foreground">{new Date(h.created_at).toLocaleString()} · {h.action}{h.actor_email ? ` · ${h.actor_email}` : ''}</div>
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => restore(h.id)}><RotateCcw /> RESTORE</Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ fixture, teams, onClose, onSaved }: { fixture: Fixture; teams: TeamRow[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(fixture));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const codeOptions = useMemo(() => [...new Set([...teams.map((t) => t.code), fixture.home_code, fixture.away_code])].filter(Boolean).sort(), [teams, fixture.home_code, fixture.away_code]);
  const [pomOptions, setPomOptions] = useState<{ id: string; name: string }[]>([]);
  const [autoPom, setAutoPom] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchTeamRoster(fixture.home_code), fetchTeamRoster(fixture.away_code)]).then(([h, a]) => {
      if (alive) setPomOptions([...h, ...a].map((p) => ({ id: p.id, name: p.name })));
    });
    fetchMatchPom(fixture.match_number).then((p) => { if (alive) setAutoPom(p?.auto_name ?? null); });
    return () => { alive = false; };
  }, [fixture.home_code, fixture.away_code, fixture.match_number]);

  const save = async () => {
    if (form.status === 'completed' && !form.home_score && !form.away_score
      && !window.confirm('Marking completed with no scores — the match will count as played with no result. Continue?')) return;
    setBusy(true);
    const patch: Record<string, unknown> = {
      match_date: form.match_date, match_time: form.match_time, venue: form.venue, status: form.status,
      home_code: form.home_code, away_code: form.away_code,
      home_score: form.home_score, away_score: form.away_score, home_overs: form.home_overs, away_overs: form.away_overs,
      result_type: form.result_type, points_home: form.points_home, points_away: form.points_away,
      note: form.note, published: form.published, pinned: form.pinned, winner_code: form.winner_code,
      player_of_match: form.player_of_match,
    };
    const { error } = await adminFixtureUpdate(fixture.match_number, patch);
    setBusy(false);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit('fixture.update', String(fixture.match_number), patch);
    toast.success(`Match ${fixture.match_number} saved.`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>EDIT MATCH {fixture.match_number} · {fixture.home_code} vs {fixture.away_code}</DialogTitle>
          <DialogDescription>Winner is derived from scores for completed matches unless you pick one. Overs use cricket notation (4.3 = 4 overs 3 balls).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HOME TEAM">
            <Select value={form.home_code} onValueChange={(v) => set('home_code', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{codeOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="AWAY TEAM">
            <Select value={form.away_code} onValueChange={(v) => set('away_code', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{codeOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="DATE"><Input type="date" value={form.match_date} onChange={(e) => set('match_date', e.target.value)} /></Field>
          <Field label="TIME"><Input type="time" value={form.match_time} onChange={(e) => set('match_time', e.target.value)} /></Field>
          <Field label="VENUE"><Input value={form.venue} onChange={(e) => set('venue', e.target.value)} /></Field>
          <Field label="STATUS">
            <Select value={form.status} onValueChange={(v) => set('status', v as FixtureStatus)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={`${fixture.home_code} SCORE`}><Input inputMode="numeric" value={form.home_score} onChange={(e) => set('home_score', e.target.value)} /></Field>
          <Field label={`${fixture.away_code} SCORE`}><Input inputMode="numeric" value={form.away_score} onChange={(e) => set('away_score', e.target.value)} /></Field>
          <Field label={`${fixture.home_code} OVERS`}><Input inputMode="decimal" value={form.home_overs} onChange={(e) => set('home_overs', e.target.value)} placeholder="e.g. 5 or 4.3" /></Field>
          <Field label={`${fixture.away_code} OVERS`}><Input inputMode="decimal" value={form.away_overs} onChange={(e) => set('away_overs', e.target.value)} placeholder="e.g. 5 or 4.3" /></Field>
          <Field label="RESULT TYPE">
            <Select value={form.result_type} onValueChange={(v) => set('result_type', v as FixtureResultType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{RESULTS.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="WINNER (OPTIONAL)">
            <Select value={form.winner_code || '__auto'} onValueChange={(v) => set('winner_code', v === '__auto' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto">Auto from scores</SelectItem>
                <SelectItem value={fixture.home_code}>{fixture.home_code}</SelectItem>
                <SelectItem value={fixture.away_code}>{fixture.away_code}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="POINTS OVERRIDE (HOME)"><Input inputMode="numeric" value={form.points_home} onChange={(e) => set('points_home', e.target.value)} placeholder="auto" /></Field>
          <Field label="POINTS OVERRIDE (AWAY)"><Input inputMode="numeric" value={form.points_away} onChange={(e) => set('points_away', e.target.value)} placeholder="auto" /></Field>
          <div className="sm:col-span-2"><Field label="NOTE"><Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. forfeit, super over, penalty…" /></Field></div>
          <div className="sm:col-span-2">
            <Field label="PLAYER OF THE MATCH">
              <Select value={form.player_of_match || '__auto'} onValueChange={(v) => set('player_of_match', v === '__auto' ? '' : v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Auto{autoPom ? ` · ${autoPom}` : ''}</SelectItem>
                  {pomOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
            <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={form.published} onChange={(e) => set('published', e.target.checked)} />
            PUBLISHED (visible on the public fixtures page)
          </label>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
            <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} />
            PIN TEAMS — keep these teams even when the bracket auto-advances
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>CANCEL</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} SAVE</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ teams, days, onClose, onSaved }: { teams: TeamRow[]; days: string[]; onClose: () => void; onSaved: () => void }) {
  const [stage, setStage] = useState<FixtureStage>('league');
  const [group, setGroup] = useState('__none');
  const [home, setHome] = useState(teams[0]?.code ?? '');
  const [away, setAway] = useState(teams[1]?.code ?? '');
  const [date, setDate] = useState(days[0] ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('08:00');
  const [venue, setVenue] = useState('DPL Arena');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (home === away) return toast.error('Home and away must differ.');
    setBusy(true);
    const { error } = await adminFixtureCreate({ stage, group: group === '__none' ? null : (group as 'A' | 'B'), home, away, date, time, venue });
    setBusy(false);
    if (error) return toast.error(`Failed: ${error}`);
    void logAudit('fixture.create', null, { stage, group, home, away, date, time });
    toast.success('Match created.');
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ADD MATCH</DialogTitle>
          <DialogDescription>Adds a new fixture at the end of the running order.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="STAGE">
            <Select value={stage} onValueChange={(v) => setStage(v as FixtureStage)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="GROUP">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">None</SelectItem><SelectItem value="A">Group A</SelectItem><SelectItem value="B">Group B</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="HOME">
            <Select value={home} onValueChange={setHome}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{teams.map((t) => <SelectItem key={t.code} value={t.code}>{t.code} · {t.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="AWAY">
            <Select value={away} onValueChange={setAway}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{teams.map((t) => <SelectItem key={t.code} value={t.code}>{t.code} · {t.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="DATE"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="TIME"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="VENUE"><Input value={venue} onChange={(e) => setVenue(e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>CANCEL</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} CREATE</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}
