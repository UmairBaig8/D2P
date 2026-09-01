import { useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight, Download, Loader2, Mail, MapPin, Pencil, Shield, Star, UserCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchAdminPlayers, fetchAdminTeams, adminAssignPlayer, adminRemovePlayerFromTeam, adminUpdatePlayer, adminAddPlayer, type AdminPlayer, type AdminTeam } from '@/lib/site';
import { uploadPlayerPhoto } from '@/lib/registrations';

const LOCATIONS = ['CZ', 'SP', 'Mumbai', 'Other'];
const PLAYER_TYPES = ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper-batter'];
const GENDERS = ['Male', 'Female'];
const BATTING_STYLES = ['Right-hand batter', 'Left-hand batter'];
const BOWLING_STYLES = ['Right-arm pace', 'Left-arm pace', 'Right-arm spin', 'Left-arm spin', 'Do not bowl'];
const BOWLING_ARMS = ['Right arm', 'Left arm', 'Not applicable'];
const CRICKET_EXPERIENCES = ['New to cricket', 'Casual player', 'Club / college player', 'Experienced league player'];
const JERSEY_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const AVAILABILITIES = ['Available for all matches', 'Available for most matches', 'Need schedule confirmation'];
const ROLES = ['player', 'vice_captain', 'captain'];

type AddPlayerForm = {
  name: string;
  email: string;
  employee_id: string;
  gender: string;
  location: string;
  player_type: string;
  batting_style: string;
  bowling_style: string;
  bowling_arm: string;
  cricket_experience: string;
  jersey_size: string;
  availability: string;
  self_rating: number;
  dpl_played: boolean;
};

const DEFAULT_ADD_FORM: AddPlayerForm = {
  name: '',
  email: '',
  employee_id: '',
  gender: 'Male',
  location: 'CZ',
  player_type: 'Batter',
  batting_style: 'Right-hand batter',
  bowling_style: 'Do not bowl',
  bowling_arm: 'Not applicable',
  cricket_experience: 'Casual player',
  jersey_size: 'M',
  availability: 'Available for most matches',
  self_rating: 3,
  dpl_played: false,
};

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function playerTypes(players: AdminPlayer[]): string[] {
  return [...new Set(players.map((player) => player.player_type))].sort();
}

function toCSV(players: AdminPlayer[], teams: AdminTeam[]): string {
  const teamCode = new Map(teams.map((team) => [team.id, team.code ?? team.name]));
  const header = ['name', 'email', 'employee_id', 'gender', 'location', 'player_type', 'dpl_played', 'self_rating', 'batting_style', 'bowling_style', 'availability', 'team', 'role', 'created_at'];
  const escape = (value: string | null | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`;
  const rows = players.map((player) => [
    escape(player.name),
    escape(player.email),
    escape(player.employee_id),
    escape(player.gender),
    escape(player.location),
    escape(player.player_type),
    player.dpl_played ? 'yes' : 'no',
    String(player.self_rating),
    escape(player.batting_style),
    escape(player.bowling_style),
    escape(player.availability),
    escape(player.team_id ? teamCode.get(player.team_id) : ''),
    escape(player.role),
    escape(player.created_at),
  ]);
  return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function downloadCSV(players: AdminPlayer[], teams: AdminTeam[]) {
  const blob = new Blob([toCSV(players, teams)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dpl-players-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PlayersTab({ preset: presetProp = null, onPresetApplied }: { preset?: { photo?: boolean; unassigned?: boolean } | null; onPresetApplied?: () => void }) {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [photoFilter, setPhotoFilter] = useState<'all' | 'with' | 'missing'>('all');
  const [sort, setSort] = useState<'newest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTeamId, setBulkTeamId] = useState('');
  const [bulkRole, setBulkRole] = useState('player');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState<AdminPlayer | null>(null);
  const [editing, setEditing] = useState<AdminPlayer | null>(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<AddPlayerForm>(DEFAULT_ADD_FORM);
  const [saving, setSaving] = useState(false);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState('');
  const [editRemovePhoto, setEditRemovePhoto] = useState(false);
  const [addPhotoFile, setAddPhotoFile] = useState<File | null>(null);
  const [addPhotoPreview, setAddPhotoPreview] = useState('');

  const openEdit = (player: AdminPlayer) => {
    setEditing({ ...player });
    setEditPhotoFile(null);
    setEditPhotoPreview('');
    setEditRemovePhoto(false);
  };

  const pickEditPhoto = (file: File | null) => {
    setEditPhotoFile(file);
    setEditPhotoPreview(file ? URL.createObjectURL(file) : '');
    setEditRemovePhoto(false);
  };

  const openAdd = () => {
    setAddForm(DEFAULT_ADD_FORM);
    setAddPhotoFile(null);
    setAddPhotoPreview('');
    setAdding(true);
  };

  const pickAddPhoto = (file: File | null) => {
    setAddPhotoFile(file);
    setAddPhotoPreview(file ? URL.createObjectURL(file) : '');
  };

  const reload = () => {
    fetchAdminPlayers().then(setPlayers);
    fetchAdminTeams().then(setTeams);
  };

  useEffect(reload, []);

  useEffect(() => {
    if (!presetProp) return;
    if (presetProp.unassigned) setTeamFilter('none');
    if (presetProp.photo) setPhotoFilter('missing');
    setPage(1);
    onPresetApplied?.();
  }, [presetProp, onPresetApplied]);

  const PAGE_SIZE = 25;

  const filtered = useMemo(() => {
    if (!players) return [];
    const needle = query.trim().toLowerCase();
    const rows = players.filter((player) => {
      if (needle && ![player.name, player.email, player.employee_id ?? ''].some((value) => value.toLowerCase().includes(needle))) return false;
      if (teamFilter !== 'all' && player.team_id !== teamFilter) return false;
      if (locationFilter !== 'all' && player.location !== locationFilter) return false;
      if (typeFilter !== 'all' && player.player_type !== typeFilter) return false;
      if (photoFilter === 'with' && !player.photo_url) return false;
      if (photoFilter === 'missing' && player.photo_url) return false;
      return true;
    });
    return rows.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.created_at.localeCompare(a.created_at)));
  }, [players, query, teamFilter, locationFilter, typeFilter, photoFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const pageSelected = pageRows.every((player) => selectedIds.has(player.id));
  const toggleAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pageSelected) pageRows.forEach((player) => next.delete(player.id));
      else pageRows.forEach((player) => next.add(player.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkAssign = async () => {
    if (!bulkTeamId || selectedIds.size === 0) return;
    setBulkSaving(true);
    const names: string[] = [];
    let failed = false;
    for (const id of selectedIds) {
      const player = players?.find((row) => row.id === id);
      const { error } = await adminAssignPlayer(id, bulkTeamId, bulkRole);
      if (error) failed = true;
      else if (player) names.push(player.name);
    }
    setBulkSaving(false);
    if (failed) toast.error('Some assignments failed.');
    else toast.success(`Assigned ${names.length} player${names.length === 1 ? '' : 's'}.`);
    setSelectedIds(new Set());
    setBulkTeamId('');
    reload();
  };

  const assign = async (player: AdminPlayer, teamId: string, role: string) => {
    const { error } = await adminAssignPlayer(player.id, teamId, role);
    if (error) toast.error(`Failed: ${error}`);
    else toast.success(`Assigned ${player.name}.`);
    if (!error) reload();
  };

  const unassign = async (player: AdminPlayer) => {
    const { error } = await adminRemovePlayerFromTeam(player.id);
    if (error) toast.error(`Failed: ${error}`);
    else toast.success(`Removed ${player.name}.`);
    if (!error) reload();
  };

  const flipDpl = async (player: AdminPlayer) => {
    const { error } = await adminUpdatePlayer(player.id, { dpl_played: !player.dpl_played });
    if (error) toast.error(`Failed: ${error}`);
    else toast.success(`${player.name} DPL status toggled.`);
    if (!error) reload();
  };

  const saveEdits = async () => {
    if (!selected || !editing) return;
    setSaving(true);
    const patch: {
      name?: string;
      email?: string;
      employee_id?: string | null;
      location?: string;
      player_type?: string;
      gender?: string;
      self_rating?: number;
      dpl_played?: boolean;
      batting_style?: string | null;
      bowling_style?: string | null;
      bowling_arm?: string | null;
      availability?: string | null;
      photo_url?: string | null;
    } = {};
    if (editing.name.trim() !== selected.name) patch.name = editing.name.trim();
    if (editing.email.trim() !== selected.email) patch.email = editing.email.trim();
    if ((editing.employee_id ?? '') !== (selected.employee_id ?? '')) patch.employee_id = editing.employee_id?.trim() || null;
    if (editing.location !== selected.location) patch.location = editing.location;
    if (editing.player_type !== selected.player_type) patch.player_type = editing.player_type;
    if (editing.gender !== selected.gender) patch.gender = editing.gender;
    if (editing.self_rating !== selected.self_rating) patch.self_rating = editing.self_rating;
    if (editing.dpl_played !== selected.dpl_played) patch.dpl_played = editing.dpl_played;
    if (editing.batting_style !== selected.batting_style) patch.batting_style = editing.batting_style || null;
    if (editing.bowling_style !== selected.bowling_style) patch.bowling_style = editing.bowling_style || null;
    if (editing.bowling_arm !== selected.bowling_arm) patch.bowling_arm = editing.bowling_arm || null;
    if (editing.availability !== selected.availability) patch.availability = editing.availability || null;
    if (editPhotoFile) {
      try {
        patch.photo_url = await uploadPlayerPhoto(editPhotoFile);
      } catch (photoError) {
        setSaving(false);
        toast.error(`Photo upload failed: ${photoError instanceof Error ? photoError.message : String(photoError)}`);
        return;
      }
    } else if (editRemovePhoto) {
      patch.photo_url = null;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    const { error } = await adminUpdatePlayer(selected.id, patch);
    setSaving(false);
    if (error) {
      toast.error(`Failed: ${error}`);
      return;
    }
    toast.success('Player updated.');
    setEditing(null);
    reload();
  };

  const addPlayer = async () => {
    if (!addForm.name.trim() || !addForm.email.trim() || !addForm.employee_id.trim()) {
      toast.error('Name, email and employee ID are required.');
      return;
    }
    setSaving(true);
    let photoUrl: string | null = null;
    if (addPhotoFile) {
      try {
        photoUrl = await uploadPlayerPhoto(addPhotoFile);
      } catch (photoError) {
        setSaving(false);
        toast.error(`Photo upload failed: ${photoError instanceof Error ? photoError.message : String(photoError)}`);
        return;
      }
    }
    const { error } = await adminAddPlayer({
      name: addForm.name.trim(),
      email: addForm.email.trim(),
      employee_id: addForm.employee_id.trim(),
      gender: addForm.gender || null,
      location: addForm.location || null,
      player_type: addForm.player_type,
      batting_style: addForm.batting_style,
      bowling_style: addForm.bowling_style,
      bowling_arm: addForm.bowling_arm,
      cricket_experience: addForm.cricket_experience,
      jersey_size: addForm.jersey_size,
      availability: addForm.availability,
      self_rating: addForm.self_rating,
      dpl_played: addForm.dpl_played,
      photo_url: photoUrl,
    });
    setSaving(false);
    if (error) {
      toast.error(`Failed: ${error}`);
      return;
    }
    toast.success(`${addForm.name.trim()} added.`);
    setAdding(false);
    setAddForm(DEFAULT_ADD_FORM);
    reload();
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-wide">PLAYERS {players ? `(${filtered.length}/${players.length})` : ''}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sort === 'newest' ? setSort('name') : setSort('newest')}
            title={sort === 'newest' ? 'Sorted by newest — click for A–Z' : 'Sorted by name — click for newest'}
          >
            {sort === 'newest' ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
            {sort === 'newest' ? 'NEWEST' : 'A–Z'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => players && downloadCSV(players, teams)} disabled={!players?.length}>
            <Download /> CSV
          </Button>
          <Button size="sm" onClick={openAdd}><UserPlus /> ADD PLAYER</Button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          id="players-search"
          placeholder="Search name, email or employee ID…  ( / to focus )"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="sm:col-span-2"
        />
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL LOCATIONS</SelectItem>
            {LOCATIONS.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL TYPES</SelectItem>
            {playerTypes(players ?? []).map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={photoFilter} onValueChange={(value) => setPhotoFilter(value as 'all' | 'with' | 'missing')}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL PHOTOS</SelectItem>
            <SelectItem value="with">WITH PHOTO</SelectItem>
            <SelectItem value="missing">MISSING PHOTO</SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:col-span-2 lg:col-span-4">
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL TEAMS</SelectItem>
              <SelectItem value="none">UNASSIGNED</SelectItem>
              {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.code} — {team.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-accent/40 px-3 py-2">
          <span className="text-xs font-semibold">{selectedIds.size} SELECTED</span>
          <Select value={bulkTeamId} onValueChange={setBulkTeamId}>
            <SelectTrigger className="w-44" size="sm"><SelectValue placeholder="Assign to team…" /></SelectTrigger>
            <SelectContent>
              {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.code} — {team.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bulkRole} onValueChange={setBulkRole}>
            <SelectTrigger className="w-36" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => <SelectItem key={role} value={role}>{role.toUpperCase().replace('_', ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={bulkAssign} disabled={!bulkTeamId || bulkSaving}>
            {bulkSaving ? <Loader2 className="animate-spin" /> : <Users />} APPLY
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setBulkTeamId(''); }}>CLEAR</Button>
        </div>
      )}

      {!players ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((row) => <Skeleton key={row} className="h-12 w-full" />)}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={pageRows.length > 0 && pageSelected}
                  onCheckedChange={toggleAllPage}
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Select all on page"
                />
              </TableHead>
              <TableHead className="w-12">PLAYER</TableHead>
              <TableHead>NAME</TableHead>
              <TableHead>DETAILS</TableHead>
              <TableHead>TEAM</TableHead>
              <TableHead>ROLE</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead className="text-right">ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {players.length === 0 ? 'No registrations yet.' : 'No players match the current filters.'}
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((player) => (
              <TableRow key={player.id} className="cursor-pointer" onClick={() => setSelected(player)}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(player.id)}
                    onCheckedChange={() => toggleOne(player.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${player.name}`}
                  />
                </TableCell>
                <TableCell>
                  {player.photo_url
                    ? <img src={player.photo_url} alt="" className="size-9 rounded-full object-cover" />
                    : <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 font-display text-xs font-bold text-primary">{initialsOf(player.name)}</div>}
                </TableCell>
                <TableCell className="font-medium">{player.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {[player.employee_id, player.location, player.player_type].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell>
                  <Select
                    value={player.team_id ?? 'none'}
                    onValueChange={(value) => {
                      if (value === 'none') { if (player.team_id) unassign(player); return; }
                      assign(player, value, player.role ?? 'player');
                    }}
                  >
                    <SelectTrigger className="w-28" size="sm" onClick={(event) => event.stopPropagation()}>
                      <SelectValue>{player.team_code ?? '— team —'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— team —</SelectItem>
                      {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={player.role ?? 'player'}
                    disabled={!player.team_id}
                    onValueChange={(role) => { if (player.team_id) assign(player, player.team_id, role); }}
                  >
                    <SelectTrigger className="w-32" size="sm" onClick={(event) => event.stopPropagation()}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => <SelectItem key={role} value={role}>{role.toUpperCase().replace('_', ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {player.role === 'captain' ? <Badge variant="secondary"><Shield /> CAPTAIN</Badge>
                    : player.role === 'vice_captain' ? <Badge variant="secondary"><Shield /> VC</Badge>
                    : player.dpl_played ? <Badge variant="outline"><UserCheck /> VET</Badge>
                    : <span className="text-xs text-muted-foreground">ROOKIE</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); flipDpl(player); }}>
                    {player.dpl_played ? 'VET' : 'ROOKIE'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {players && filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {filtered.length} player{filtered.length === 1 ? '' : 's'} · page {page} / {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft /> PREV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              NEXT <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setEditing(null); } }}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>
                  {selected.email} · Registered {new Date(selected.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </DialogDescription>
              </DialogHeader>

              {!editing ? (
                <>
                  <div className="flex items-center gap-4">
                    {selected.photo_url
                      ? <img src={selected.photo_url} alt="" className="size-16 rounded-full object-cover" />
                      : <div className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 font-display text-lg font-bold text-primary">{initialsOf(selected.name)}</div>}
                    <div className="grid gap-1 text-sm">
                      <div className="flex items-center gap-2"><MapPin className="size-3.5 text-muted-foreground" /> {selected.location} · {selected.gender}</div>
                      <div className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground" /> {selected.email}</div>
                      <div className="flex items-center gap-2"><Star className="size-3.5 text-muted-foreground" /> {'★'.repeat(selected.self_rating)}{'☆'.repeat(5 - selected.self_rating)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm">
                    <div><div className="text-xs font-semibold text-muted-foreground">EMPLOYEE ID</div><div className="font-medium">{selected.employee_id || '—'}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">PLAYER TYPE</div><div className="font-medium">{selected.player_type}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">LOCATION</div><div className="font-medium">{selected.location}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">GENDER</div><div className="font-medium">{selected.gender}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">BATTING</div><div className="font-medium">{selected.batting_style || '—'}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">BOWLING</div><div className="font-medium">{selected.bowling_style || '—'}{selected.bowling_arm && selected.bowling_arm !== 'Not applicable' ? ` · ${selected.bowling_arm}` : ''}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">AVAILABILITY</div><div className="font-medium">{selected.availability || '—'}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">DPL STATUS</div><div className="font-medium">{selected.dpl_played ? 'DPL VET' : 'DPL ROOKIE'}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">TEAM</div><div className="font-medium">{selected.team_code ? `${selected.team_code}${selected.role ? ` · ${selected.role.toUpperCase().replace('_', ' ')}` : ''}` : 'Unassigned'}</div></div>
                    <div><div className="text-xs font-semibold text-muted-foreground">JOINED</div><div className="font-medium">{new Date(selected.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => selected && openEdit(selected)}><Pencil /> EDIT PROFILE</Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="grid gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-full border bg-muted">
                      {editPhotoPreview ? (
                        <img src={editPhotoPreview} alt="" className="size-full object-cover" />
                      ) : editing.photo_url && !editRemovePhoto ? (
                        <img src={editing.photo_url} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center text-sm font-bold text-muted-foreground">{initialsOf(editing.name)}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      <label className="cursor-pointer text-xs font-semibold text-primary hover:underline">
                        CHANGE PHOTO
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => pickEditPhoto(e.target.files?.[0] ?? null)} />
                      </label>
                      {(editing.photo_url || editPhotoFile) && !editRemovePhoto && (
                        <button type="button" className="text-xs font-semibold text-destructive hover:underline" onClick={() => { setEditPhotoFile(null); setEditPhotoPreview(''); setEditRemovePhoto(true); }}>
                          REMOVE PHOTO
                        </button>
                      )}
                      {editRemovePhoto && <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Photo will be removed on save.</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-1.5">
                      <label htmlFor="edit-name" className="text-xs font-semibold text-muted-foreground">FULL NAME</label>
                      <Input id="edit-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <label htmlFor="edit-employee-id" className="text-xs font-semibold text-muted-foreground">EMPLOYEE ID</label>
                      <Input id="edit-employee-id" value={editing.employee_id ?? ''} onChange={(e) => setEditing({ ...editing, employee_id: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor="edit-email" className="text-xs font-semibold text-muted-foreground">EMAIL</label>
                    <Input id="edit-email" type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">LOCATION</label>
                      <Select value={editing.location} onValueChange={(location) => setEditing({ ...editing, location })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LOCATIONS.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">GENDER</label>
                      <Select value={editing.gender} onValueChange={(gender) => setEditing({ ...editing, gender })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GENDERS.map((gender) => <SelectItem key={gender} value={gender}>{gender}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">PLAYER TYPE</label>
                      <Select value={editing.player_type} onValueChange={(player_type) => setEditing({ ...editing, player_type })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PLAYER_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">BATTING STYLE</label>
                      <Select value={editing.batting_style ?? ''} onValueChange={(batting_style) => setEditing({ ...editing, batting_style: batting_style || null })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                        <SelectContent>
                          {BATTING_STYLES.map((style) => <SelectItem key={style} value={style}>{style}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">BOWLING STYLE</label>
                      <Select value={editing.bowling_style ?? ''} onValueChange={(bowling_style) => setEditing({ ...editing, bowling_style: bowling_style || null })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                        <SelectContent>
                          {BOWLING_STYLES.map((style) => <SelectItem key={style} value={style}>{style}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">BOWLING ARM</label>
                      <Select value={editing.bowling_arm ?? ''} onValueChange={(bowling_arm) => setEditing({ ...editing, bowling_arm: bowling_arm || null })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                        <SelectContent>
                          {BOWLING_ARMS.map((arm) => <SelectItem key={arm} value={arm}>{arm}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">AVAILABILITY</label>
                      <Select value={editing.availability ?? ''} onValueChange={(availability) => setEditing({ ...editing, availability: availability || null })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                        <SelectContent>
                          {AVAILABILITIES.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">SELF RATING</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          className={`rounded p-0.5 text-2xl leading-none transition-colors ${star <= editing.self_rating ? 'text-amber-500' : 'text-muted'}`}
                          onClick={() => setEditing({ ...editing, self_rating: star })}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={editing.dpl_played} onChange={(e) => setEditing({ ...editing, dpl_played: e.target.checked })} />
                    PLAYED DPL BEFORE (VET)
                  </label>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditing(null)}>CANCEL</Button>
                    <Button onClick={saveEdits} disabled={saving}>{saving ? 'SAVING…' : 'SAVE'}</Button>
                  </DialogFooter>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={(open) => { if (!open && !saving) setAdding(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ADD PLAYER</DialogTitle>
            <DialogDescription>Registers a player manually — use for walk-ins or paper signups. Employee ID must be unique.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-4">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border bg-muted">
                {addPhotoPreview ? (
                  <img src={addPhotoPreview} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-muted-foreground">PHOTO</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-2">
                <label className="cursor-pointer text-xs font-semibold text-primary hover:underline">
                  UPLOAD PHOTO (OPTIONAL)
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => pickAddPhoto(e.target.files?.[0] ?? null)} />
                </label>
                {addPhotoFile && (
                  <button type="button" className="text-xs font-semibold text-destructive hover:underline" onClick={() => pickAddPhoto(null)}>CLEAR</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="add-name" className="text-xs font-semibold text-muted-foreground">FULL NAME *</label>
                <Input id="add-name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="add-employee-id" className="text-xs font-semibold text-muted-foreground">EMPLOYEE ID *</label>
                <Input id="add-employee-id" value={addForm.employee_id} onChange={(e) => setAddForm({ ...addForm, employee_id: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="add-email" className="text-xs font-semibold text-muted-foreground">EMAIL *</label>
              <Input id="add-email" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">PLAYER TYPE</label>
                <Select value={addForm.player_type} onValueChange={(player_type) => setAddForm({ ...addForm, player_type })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLAYER_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">LOCATION</label>
                <Select value={addForm.location} onValueChange={(location) => setAddForm({ ...addForm, location })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">GENDER</label>
                <Select value={addForm.gender} onValueChange={(gender) => setAddForm({ ...addForm, gender })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((gender) => <SelectItem key={gender} value={gender}>{gender}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">BATTING STYLE</label>
                <Select value={addForm.batting_style} onValueChange={(batting_style) => setAddForm({ ...addForm, batting_style })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BATTING_STYLES.map((style) => <SelectItem key={style} value={style}>{style}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">BOWLING STYLE</label>
                <Select value={addForm.bowling_style} onValueChange={(bowling_style) => setAddForm({ ...addForm, bowling_style })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOWLING_STYLES.map((style) => <SelectItem key={style} value={style}>{style}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">BOWLING ARM</label>
                <Select value={addForm.bowling_arm} onValueChange={(bowling_arm) => setAddForm({ ...addForm, bowling_arm })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOWLING_ARMS.map((arm) => <SelectItem key={arm} value={arm}>{arm}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">EXPERIENCE</label>
                <Select value={addForm.cricket_experience} onValueChange={(cricket_experience) => setAddForm({ ...addForm, cricket_experience })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CRICKET_EXPERIENCES.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">JERSEY SIZE</label>
                <Select value={addForm.jersey_size} onValueChange={(jersey_size) => setAddForm({ ...addForm, jersey_size })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JERSEY_SIZES.map((size) => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">AVAILABILITY</label>
                <Select value={addForm.availability} onValueChange={(availability) => setAddForm({ ...addForm, availability })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AVAILABILITIES.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">SELF RATING</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`rounded p-0.5 text-2xl leading-none transition-colors ${star <= addForm.self_rating ? 'text-amber-500' : 'text-muted'}`}
                      onClick={() => setAddForm({ ...addForm, self_rating: star })}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" checked={addForm.dpl_played} onChange={(e) => setAddForm({ ...addForm, dpl_played: e.target.checked })} />
              PLAYED DPL BEFORE (VET)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>CANCEL</Button>
            <Button onClick={addPlayer} disabled={saving}>{saving ? 'ADDING…' : 'ADD PLAYER'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}