import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Loader2, Camera } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import ProfileCard from '@/components/ProfileCard';
import { useTheme } from '@/lib/useTheme';
import { fetchPlayersList, submitPlayerEdit, type PublicPlayer } from '@/lib/site';
import { uploadPlayerPhoto } from '@/lib/registrations';
import { Toaster } from '@/components/ui/sonner';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const ROLE_OPTIONS = ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper-batter'];
const BATTING_OPTIONS = ['Right-hand batter', 'Left-hand batter'];
const BOWLING_OPTIONS = ['Do not bowl', 'Right-arm pace', 'Left-arm pace', 'Right-arm spin', 'Left-arm spin'];
const ARM_OPTIONS = ['Not applicable', 'Right arm', 'Left arm'];
const LOCATION_OPTIONS = ['CZ', 'SP', 'Mumbai', 'Other'];
const AVAILABILITY_OPTIONS = ['Available for all matches', 'Available for most matches', 'Need schedule confirmation'];

const editSchema = z.object({
  name: z.string().min(2, 'Name is required.'),
  player_type: z.string().min(1, 'Role is required.'),
  gender: z.string().min(1, 'Gender is required.'),
  location: z.string().min(1, 'Area is required.'),
  batting_style: z.string(),
  bowling_style: z.string(),
  bowling_arm: z.string(),
  availability: z.string(),
  self_rating: z.string().regex(/^[1-5]$/, 'Rate 1–5.'),
  dpl_played: z.string().min(1, 'Select an option.'),
});

type EditValues = z.infer<typeof editSchema>;

export default function PlayersPage() {
  const { dark, toggleTheme } = useTheme();
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<PublicPlayer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const query = params.get('q') ?? '';
  const role = params.get('role') ?? 'ALL ROLES';
  const area = params.get('area') ?? 'ALL AREAS';
  const roles = useMemo(() => ['ALL ROLES', ...Array.from(new Set(players.map((p) => p.player_type).filter(Boolean)))], [players]);
  const areas = useMemo(() => ['ALL AREAS', ...Array.from(new Set(players.map((p) => p.location).filter(Boolean)))], [players]);

  useEffect(() => {
    let alive = true;
    fetchPlayersList().then((rows) => {
      if (!alive) return;
      setPlayers(rows);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.player_type.toLowerCase().includes(q)) return false;
      if (role !== 'ALL ROLES' && p.player_type !== role) return false;
      if (area !== 'ALL AREAS' && p.location !== area) return false;
      return true;
    });
  }, [players, query, role, area]);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: '', player_type: '', gender: '', location: '',
      batting_style: '', bowling_style: '', bowling_arm: '',
      availability: AVAILABILITY_OPTIONS[0], self_rating: '3', dpl_played: 'NO',
    },
  });

  const openEdit = (player: PublicPlayer) => {
    setEditing(player);
    setPhotoFile(null);
    setPhotoPreview(player.photo_url ?? '');
    form.reset({
      name: player.name,
      player_type: player.player_type,
      gender: player.gender,
      location: player.location,
      batting_style: player.batting_style ?? '',
      bowling_style: player.bowling_style ?? '',
      bowling_arm: player.bowling_arm ?? '',
      availability: player.availability ?? AVAILABILITY_OPTIONS[0],
      self_rating: String(player.self_rating ?? 3),
      dpl_played: player.dpl_played ? 'YES' : 'NO',
    });
  };

  const onSubmit = async (values: EditValues) => {
    if (!editing) return;
    const changes: Record<string, unknown> = {};
    if (photoFile) {
      try {
        const url = await uploadPlayerPhoto(photoFile);
        if (url !== editing.photo_url) changes.photo_url = url;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Photo upload failed.');
        return;
      }
    }
    if (values.name !== editing.name) changes.name = values.name;
    if (values.player_type !== editing.player_type) changes.player_type = values.player_type;
    if (values.gender !== editing.gender) changes.gender = values.gender;
    if (values.location !== editing.location) changes.location = values.location;
    if (values.batting_style !== (editing.batting_style ?? '')) changes.batting_style = values.batting_style;
    if (values.bowling_style !== (editing.bowling_style ?? '')) changes.bowling_style = values.bowling_style;
    if (values.bowling_arm !== (editing.bowling_arm ?? '')) changes.bowling_arm = values.bowling_arm;
    if (values.availability !== (editing.availability ?? AVAILABILITY_OPTIONS[0])) changes.availability = values.availability;
    if (values.self_rating !== String(editing.self_rating ?? 3)) changes.self_rating = Number(values.self_rating);
    if (values.dpl_played !== (editing.dpl_played ? 'YES' : 'NO')) changes.dpl_played = values.dpl_played === 'YES';

    if (Object.keys(changes).length === 0) {
      toast.info('Nothing changed.');
      return;
    }

    setSubmitting(true);
    const result = await submitPlayerEdit(editing.id, editing.name, changes);
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Edit submitted for admin approval.');
    setEditing(null);
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'ALL ROLES' && value !== 'ALL AREAS') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className={dark ? 'app dark players-page' : 'app players-page'}>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="players-main shell">
        <div className="players-toolbar">
          <Badge variant="secondary" className="px-3 py-1">{filtered.length} PLAYERS</Badge>
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="players-search"
              className="pl-9"
              placeholder="Search by name or role…"
              value={query}
              onChange={(event) => setParam('q', event.target.value)}
            />
          </div>
          <Select value={role} onValueChange={(value) => setParam('role', value)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={area} onValueChange={(value) => setParam('area', value)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <section className="players-grid">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-5">
                  <Skeleton className="mx-auto size-20 rounded-2xl" />
                  <Skeleton className="mx-auto mt-3 h-4 w-24" />
                  <Skeleton className="mx-auto mt-2 h-3 w-16" />
                </CardContent>
              </Card>
            ))
            : filtered.map((player) => (
              <ProfileCard
                key={player.id}
                avatarUrl={player.photo_url}
                name={player.name}
                title={player.player_type}
                handle={player.location || 'DPL 2026'}
                status={player.dpl_played ? '★ DPL 2025 ALUM' : 'NEW TO DPL 2026'}
                fallbackInitials={player.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                rating={player.self_rating}
                batting={player.batting_style}
                onEdit={() => openEdit(player)}
              />
            ))}
          </section>

        {!loading && filtered.length === 0 && (
          <p className="players-empty">No players match your search.</p>
        )}
      </main>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className={`registration-card edit-dialog max-h-[85vh] overflow-y-auto${dark ? ' dialog-dark' : ''}`}>
          <DialogHeader>
            <DialogTitle>Propose edit — {editing?.name}</DialogTitle>
            <DialogDescription>
              Your changes go to the tournament committee for approval. Nothing updates live.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="registration-form">
            <div className="form-grid" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'start' }}>
              <div>
                <label className="block w-32 cursor-pointer">
                  <span className="edit-photo relative block aspect-3/4 overflow-hidden rounded-[10px] border shadow-sm transition-shadow hover:shadow-md">
                    {photoPreview
                      ? <img src={photoPreview} alt="Player photo" className="h-full w-full object-cover" />
                      : <span className="edit-photo-fallback flex h-full w-full items-center justify-center text-4xl">📷</span>}
                    <span className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/60 via-transparent to-transparent pb-2 text-[10px] font-bold tracking-widest text-white opacity-0 transition-opacity hover:opacity-100">
                      CHANGE PHOTO
                    </span>
                    <span className="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-[#65e5ed]/90 text-[#071426] shadow">
                      <Camera className="size-3.5" />
                    </span>
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setPhotoFile(file);
                      if (file) setPhotoPreview(URL.createObjectURL(file));
                    }}
                  />
                </label>
                {photoFile ? (
                  <button type="button" className="mt-1 block text-[11px] font-bold text-[#d92d20] hover:underline" onClick={() => { setPhotoFile(null); setPhotoPreview(editing?.photo_url ?? ''); }}>
                    Remove photo
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3">
                <label className="field-label">
                  Full name
                  <input type="text" placeholder="e.g. Virat Kohli" {...form.register('name')} />
                </label>
                {form.formState.errors.name ? <em className="field-error">{form.formState.errors.name.message}</em> : null}
                <div className="form-grid">
                  <div>
                    <label className="field-label">
                      Location
                      <select {...form.register('location')}>
                        {LOCATION_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </label>
                    {form.formState.errors.location ? <em className="field-error">{form.formState.errors.location.message}</em> : null}
                  </div>
                  <div>
                    <label className="field-label">
                      Gender
                      <select {...form.register('gender')}>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                    </label>
                    {form.formState.errors.gender ? <em className="field-error">{form.formState.errors.gender.message}</em> : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="form-grid">
              <div>
                <label className="field-label">
                  Player type
                  <select {...form.register('player_type')}>
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                {form.formState.errors.player_type ? <em className="field-error">{form.formState.errors.player_type.message}</em> : null}
              </div>
              <div>
                <label className="field-label">
                  Batting style
                  <select {...form.register('batting_style')}>
                    {BATTING_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {form.formState.errors.batting_style ? <em className="field-error">{form.formState.errors.batting_style.message}</em> : null}
              </div>
              <div>
                <label className="field-label">
                  Bowling style
                  <select {...form.register('bowling_style')}>
                    {BOWLING_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {form.formState.errors.bowling_style ? <em className="field-error">{form.formState.errors.bowling_style.message}</em> : null}
              </div>
              <div>
                <label className="field-label">
                  Bowling arm
                  <select {...form.register('bowling_arm')}>
                    {ARM_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {form.formState.errors.bowling_arm ? <em className="field-error">{form.formState.errors.bowling_arm.message}</em> : null}
              </div>
              <div>
                <label className="field-label">
                  Rate your game (1–5)
                  <select {...form.register('self_rating')}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                  </select>
                </label>
                {form.formState.errors.self_rating ? <em className="field-error">{form.formState.errors.self_rating.message}</em> : null}
              </div>
              <div>
                <label className="field-label">
                  Played DPL before?
                  <select {...form.register('dpl_played')}>
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                  </select>
                </label>
                {form.formState.errors.dpl_played ? <em className="field-error">{form.formState.errors.dpl_played.message}</em> : null}
              </div>
            </div>
            <div className="edit-avail">
              <label className="field-label">
                Match availability
                <select {...form.register('availability')}>
                  {AVAILABILITY_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              {form.formState.errors.availability ? <em className="field-error">{form.formState.errors.availability.message}</em> : null}
            </div>
            <div className="form-nav" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>CANCEL</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                SUBMIT FOR APPROVAL
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

