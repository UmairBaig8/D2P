import { FormEvent, useEffect, useState } from 'react';
import { registerPlayer, checkEmployeeExists } from '@/lib/registrations';
import { useTheme } from '@/lib/useTheme';
import SiteHeader from '@/components/SiteHeader';
import Stepper from '@/components/Stepper';
import BorderGlow from '@/components/BorderGlow';
import { withBase } from '@/lib/base';
import type { RegistrationInput } from '@/types';

const initialForm: RegistrationInput = {
  name: '', email: '', employee_id: '', gender: 'Male', location: 'CZ', dpl_played: false, self_rating: 3,
  player_type: 'Batter', batting_style: 'Right-hand batter',
  bowling_style: 'Do not bowl', bowling_arm: 'Not applicable', availability: 'Available for all matches',
};

type EmpStatus = 'idle' | 'checking' | 'free' | 'taken';
type FieldName = keyof RegistrationInput | 'photo';
type Errors = Partial<Record<FieldName, string>>;
type Touched = Partial<Record<FieldName, boolean>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMP_ID_RE = /^\d{5,9}$/;
const PHOTO_MAX_MB = 4;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function validateField(field: FieldName, value: string | File | null, empStatus: EmpStatus): string {
  switch (field) {
    case 'name': {
      const name = String(value ?? '').trim();
      if (!name) return 'Full name is required.';
      if (name.length < 2) return 'Name must be at least 2 characters.';
      if (!/^[a-zA-Z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\s.'-]*$/.test(name)) return 'Name can only contain letters, spaces, dots and hyphens.';
      return '';
    }
    case 'email': {
      const email = String(value ?? '').trim();
      if (!email) return 'Work email is required.';
      if (!EMAIL_RE.test(email)) return 'Enter a valid email address (e.g. you@company.com).';
      return '';
    }
    case 'employee_id': {
      const id = String(value ?? '').trim();
      if (!id) return 'Employee ID is required.';
      if (!EMP_ID_RE.test(id)) return 'Employee ID must be a 5–9 digit number.';
      if (empStatus === 'taken') return 'This employee ID is already registered.';
      if (empStatus === 'checking') return 'Checking employee ID…';
      return '';
    }
    case 'gender':
    case 'location':
    case 'player_type':
    case 'batting_style':
    case 'bowling_style':
    case 'bowling_arm':
    case 'availability':
    case 'self_rating':
      if (!value) return 'Select an option.';
      return '';
    case 'photo': {
      if (!value) return 'Profile photo is required.';
      const file = value as File;
      if (!PHOTO_TYPES.includes(file.type)) return 'Only JPG, PNG or WEBP images are allowed.';
      if (file.size > PHOTO_MAX_MB * 1024 * 1024) return `Photo must be under ${PHOTO_MAX_MB} MB.`;
      return '';
    }
    default:
      return '';
  }
}

export default function RegisterPage() {
  const { dark, toggleTheme } = useTheme();
  const [form, setForm] = useState<RegistrationInput>(initialForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [empStatus, setEmpStatus] = useState<EmpStatus>('idle');
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Touched>({});

  useEffect(() => {
    let cancelled = false;
    const id = form.employee_id.trim();
    if (!EMP_ID_RE.test(id)) {
      setEmpStatus('idle');
      return;
    }
    setEmpStatus('checking');
    const timer = window.setTimeout(() => {
      checkEmployeeExists(id)
        .then((exists) => {
          if (!cancelled) setEmpStatus(exists ? 'taken' : 'free');
        })
        .catch(() => {
          if (!cancelled) setEmpStatus('idle');
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.employee_id]);

  function fieldValue(field: FieldName): string | File | null {
    if (field === 'photo') return photo;
    const value = form[field as keyof RegistrationInput];
    return typeof value === 'string' ? value : String(value ?? '');
  }

  function fieldError(field: FieldName): string {
    if (!touched[field]) return '';
    if (field === 'employee_id' && errors.employee_id && errors.employee_id === 'Checking employee ID…') return '';
    return errors[field] ?? '';
  }

  function setField(field: keyof RegistrationInput, value: string | boolean | number) {
    setForm((prev) => ({ ...prev, [field]: value as never }));
    setErrors((prev) => ({ ...prev, [field]: validateField(field, String(value ?? ''), empStatus) }));
  }

  function blurField(field: FieldName) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateField(field, fieldValue(field), empStatus) }));
  }

  function stepFields(stepIndex: number): FieldName[] {
    if (stepIndex === 0) return ['employee_id', 'email', 'name'];
    if (stepIndex === 1) return ['player_type', 'batting_style', 'bowling_style', 'bowling_arm', 'availability'];
    if (stepIndex === 2) return ['photo'];
    return [];
  }

  function isStepAllowed(stepIndex: number): boolean {
    return stepFields(stepIndex).every((field) => !validateField(field, fieldValue(field), empStatus));
  }

  function selectPhoto(file: File | null) {
    setTouched((prev) => ({ ...prev, photo: true }));

    if (!file) {
      setPhoto(null);
      setPhotoPreview('');
      setErrors((prev) => ({ ...prev, photo: 'Profile photo is required.' }));
      return;
    }

    const err = validateField('photo', file, empStatus);
    if (err) {
      setErrors((prev) => ({ ...prev, photo: err }));
      return;
    }

    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, photo: '' }));
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    setTouched({ employee_id: true, name: true, email: true, photo: true });
    const fields: FieldName[] = ['employee_id', 'name', 'email', 'gender', 'location', 'player_type', 'batting_style', 'bowling_style', 'bowling_arm', 'availability', 'self_rating', 'photo'];
    const nextErrors: Errors = {};
    for (const field of fields) nextErrors[field] = validateField(field, fieldValue(field), empStatus);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some((err) => err)) {
      setMessage({ kind: 'error', text: 'Please fix the highlighted fields before submitting.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const trimmed = { ...form, name: form.name.trim(), email: form.email.trim().toLowerCase(), employee_id: form.employee_id.trim() };
      const result = await registerPlayer(trimmed, photo ?? undefined);
      if (result.demo) {
        setMessage({ kind: 'success', text: 'Demo registration saved locally. Connect Supabase to go live.' });
        setSubmitting(false);
      } else {
        window.location.href = `${withBase('/confirmation')}?name=${encodeURIComponent(trimmed.name)}&email=${encodeURIComponent(trimmed.email)}`;
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/duplicate|unique constraint|already exists/i.test(raw)) {
        setMessage({ kind: 'error', text: "Looks like you've already registered with this employee ID. You're all set — see you on the pitch!" });
      } else if (/check constraint|location/i.test(raw)) {
        setMessage({ kind: 'error', text: 'Something looks off in a couple of fields. Please double-check your location and try again.' });
      } else {
        setMessage({ kind: 'error', text: 'We could not save your profile right now. Please try again in a moment.' });
      }
      setSubmitting(false);
    }
  }

  const initials = form.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'YOU';

  const empHint = empStatus === 'checking' ? <em className="reg-hint checking">Checking…</em>
    : empStatus === 'free' && EMP_ID_RE.test(form.employee_id.trim()) ? <em className="reg-hint ok">✓ Available</em>
    : empStatus === 'taken' ? <em className="reg-hint warn">✓ Already registered</em>
    : null;

  const fieldProps = (field: FieldName) => ({
    className: `reg-field${fieldError(field) ? ' has-error' : ''}${touched[field] && !fieldError(field) ? ' is-valid' : ''}`,
    'data-error': fieldError(field),
  });

  return (
    <div className={dark ? 'app dark register-page' : 'app register-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="register-main shell">
        <BorderGlow
          className="registration-glow"
          backgroundColor="#071426"
          colors={['#09c9d8', '#2f7dff', '#16c79a']}
          glowColor="196 100 48"
          glowIntensity={1.15}
          glowRadius={30}
          edgeSensitivity={22}
          borderRadius={24}
          animated
        >
          <form className="registration-form registration-card" onSubmit={submit} noValidate>
          <div className="reg-top">
            <div className="reg-title">
              <span className="reg-eyebrow">DPL 2026 · PLAYER REGISTRATION</span>
              <h2>JOIN THE LEAGUE.</h2>
              <p>Register once — get picked in the auction, play for the trophy.</p>
            </div>
            <span className="reg-time">~ 2 MIN</span>
          </div>

          <Stepper
            steps={['PERSONAL', 'CRICKET', 'PHOTO', 'CONFIRM']}
            onFinalStepCompleted={() => submit()}
            backButtonText="Back"
            nextButtonText="Continue"
            completeButtonText="🏏 CREATE MY PLAYER PROFILE"
            isStepAllowed={isStepAllowed}
            nextButtonProps={{ children: submitting ? 'SAVING…' : undefined, disabled: submitting }}
          >
            <div className="stepper-step-body">
              <div className="reg-fields">
                <div {...fieldProps('employee_id')}>
                  <label htmlFor="employee_id">Employee ID <em className="req-star">*</em></label>
                  <div className="reg-input-wrap">
                    <input
                      id="employee_id"
                      autoComplete="off"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{5,9}"
                      title="Enter your 5–9 digit employee ID"
                      maxLength={9}
                      placeholder="123456789"
                      value={form.employee_id}
                      aria-invalid={Boolean(fieldError('employee_id'))}
                      onChange={(event) => setField('employee_id', event.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => blurField('employee_id')}
                    />
                    {empHint}
                  </div>
                  {fieldError('employee_id') ? <small className="reg-error">{fieldError('employee_id')}</small> : null}
                </div>

                <div {...fieldProps('email')}>
                  <label htmlFor="email">Work email <em className="req-star">*</em></label>
                  <div className="reg-input-wrap">
                    <input
                      id="email"
                      autoComplete="email"
                      required
                      type="email"
                      placeholder="you@company.com"
                      value={form.email}
                      aria-invalid={Boolean(fieldError('email'))}
                      onChange={(event) => setField('email', event.target.value)}
                      onBlur={() => blurField('email')}
                    />
                  </div>
                  {fieldError('email') ? <small className="reg-error">{fieldError('email')}</small> : null}
                </div>

                <div {...fieldProps('name')}>
                  <label htmlFor="name">Full name <em className="req-star">*</em></label>
                  <div className="reg-input-wrap">
                    <input
                      id="name"
                      autoComplete="name"
                      required
                      minLength={2}
                      placeholder="e.g. Virat Kohli"
                      value={form.name}
                      aria-invalid={Boolean(fieldError('name'))}
                      onChange={(event) => setField('name', event.target.value)}
                      onBlur={() => blurField('name')}
                    />
                  </div>
                  {fieldError('name') ? <small className="reg-error">{fieldError('name')}</small> : null}
                </div>

                <div {...fieldProps('location')}>
                  <label htmlFor="location">Location <em className="req-star">*</em></label>
                  <div className="reg-select-wrap">
                    <select id="location" required value={form.location} aria-invalid={Boolean(fieldError('location'))} onChange={(event) => setField('location', event.target.value)} onBlur={() => blurField('location')}>
                      <option value="CZ">CZ</option>
                      <option value="SP">SP</option>
                      <option value="Mumbai">Mumbai</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  {fieldError('location') ? <small className="reg-error">{fieldError('location')}</small> : null}
                </div>

                <div className="reg-field reg-gender">
                  <span className="reg-label">Gender <em className="req-star">*</em></span>
                  <div className="reg-gender-picker" role="group" aria-label="Gender">
                    {(['Male', 'Female'] as const).map((option) => (
                      <button
                        type="button"
                        className={form.gender === option ? 'on' : ''}
                        key={option}
                        onClick={() => setField('gender', option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="stepper-step-body">
              <div className="reg-fields reg-fields-3">
                <div {...fieldProps('player_type')}>
                  <label htmlFor="player_type">Player type</label>
                  <div className="reg-select-wrap">
                    <select id="player_type" required value={form.player_type} aria-invalid={Boolean(fieldError('player_type'))} onChange={(event) => setField('player_type', event.target.value)} onBlur={() => blurField('player_type')}><option>Batter</option><option>Bowler</option><option>All-rounder</option><option>Wicketkeeper-batter</option></select>
                  </div>
                </div>
                <div {...fieldProps('batting_style')}>
                  <label htmlFor="batting_style">Batting style</label>
                  <div className="reg-select-wrap">
                    <select id="batting_style" required value={form.batting_style} aria-invalid={Boolean(fieldError('batting_style'))} onChange={(event) => setField('batting_style', event.target.value)} onBlur={() => blurField('batting_style')}><option>Right-hand batter</option><option>Left-hand batter</option></select>
                  </div>
                </div>
                <div {...fieldProps('bowling_style')}>
                  <label htmlFor="bowling_style">Bowling style</label>
                  <div className="reg-select-wrap">
                    <select id="bowling_style" required value={form.bowling_style} aria-invalid={Boolean(fieldError('bowling_style'))} onChange={(event) => setField('bowling_style', event.target.value)} onBlur={() => blurField('bowling_style')}><option>Do not bowl</option><option>Right-arm pace</option><option>Left-arm pace</option><option>Right-arm spin</option><option>Left-arm spin</option></select>
                  </div>
                </div>
                <div {...fieldProps('bowling_arm')}>
                  <label htmlFor="bowling_arm">Bowling arm</label>
                  <div className="reg-select-wrap">
                    <select id="bowling_arm" required value={form.bowling_arm} aria-invalid={Boolean(fieldError('bowling_arm'))} onChange={(event) => setField('bowling_arm', event.target.value)} onBlur={() => blurField('bowling_arm')}><option>Not applicable</option><option>Right arm</option><option>Left arm</option></select>
                  </div>
                </div>
                <div className="reg-field reg-gender">
                  <span className="reg-label">Played DPL before?</span>
                  <div className="reg-gender-picker" role="group" aria-label="Played DPL before">
                    {([['Yes', true], ['No', false]] as const).map(([label, value]) => (
                      <button
                        type="button"
                        className={form.dpl_played === value ? 'on' : ''}
                        key={label}
                        onClick={() => setField('dpl_played', value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="reg-field reg-rating">
                  <span className="reg-label">Rate your game <em className="reg-opt">(1–5)</em></span>
                  <div className="reg-rating-stars" role="radiogroup" aria-label="Self rating">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={form.self_rating === star}
                        className={star <= form.self_rating ? 'on' : ''}
                        key={star}
                        onClick={() => setField('self_rating', star)}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.6 7 .6-5.3 4.6 1.6 6.9L12 17.3l-5.9 3.4 1.6-6.9L2.4 9.2l7-.6z"/></svg>
                      </button>
                    ))}
                  </div>
                </div>
                <div {...fieldProps('availability')}>
                  <label htmlFor="availability">Match availability</label>
                  <div className="reg-select-wrap">
                    <select id="availability" required value={form.availability} aria-invalid={Boolean(fieldError('availability'))} onChange={(event) => setField('availability', event.target.value)} onBlur={() => blurField('availability')}><option>Available for all matches</option><option>Available for most matches</option><option>Need schedule confirmation</option></select>
                  </div>
                </div>
              </div>
            </div>

            <div className="stepper-step-body">
              <label className={['reg-photo reg-player-card', fieldError('photo') ? 'has-error' : '', touched.photo && !fieldError('photo') ? 'is-valid' : ''].filter(Boolean).join(' ')}>
                <div className="reg-pc-side">
                  <div className="reg-pc-photo">
                    {photoPreview ? <img alt="Preview" src={photoPreview} /> : <span className="reg-pc-fallback"><i>{initials}</i></span>}
                    <span className="reg-pc-grad" />
                    {!photoPreview ? <span className="reg-pc-hint">📷 ADD PHOTO<em className="req-star">*</em></span> : null}
                    <span className="reg-pc-role">{form.player_type}</span>
                  </div>
                  <div className="reg-pc-body">
                    <div className="reg-pc-top">
                      <span className="reg-pc-league">DPL <b>2026</b></span>
                      <span className="reg-pc-no">#{form.employee_id.trim() || '—'}</span>
                    </div>
                    <strong className="reg-pc-name">{form.name.trim() || 'Your player card'}</strong>
                    <span className="reg-pc-squad">{form.location} · {form.gender}</span>
                    <div className="reg-pc-tags">
                      <span className={form.dpl_played ? 'reg-pc-tag-dpl on' : 'reg-pc-tag-dpl'}>{form.dpl_played ? 'DPL VET' : 'DPL ROOKIE'}</span>
                    </div>
                    <div className="reg-pc-styles">
                      <span>{form.batting_style}</span>
                      <span>{form.bowling_style}</span>
                    </div>
                  </div>
                </div>
                <input accept="image/png,image/jpeg,image/webp" type="file" onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)} />
              </label>
              {photoPreview ? <button type="button" className="reg-photo-clear" onClick={() => selectPhoto(null)}>Remove photo</button> : null}
              {fieldError('photo') ? <small className="reg-error">{fieldError('photo')}</small> : null}
            </div>

            <div className="stepper-step-body">
              <div className="reg-confirm">
                <p className="reg-confirm-title">YOUR PLAYER CARD</p>
                <div className="reg-pc reg-pc-static">
                  <div className="reg-pc-side">
                    <div className="reg-pc-photo">
                      {photoPreview ? <img alt="Preview" src={photoPreview} /> : <span className="reg-pc-fallback"><i>{initials}</i></span>}
                      <span className="reg-pc-grad" />
                      <span className="reg-pc-role">{form.player_type}</span>
                    </div>
                    <div className="reg-pc-body">
                      <div className="reg-pc-top">
                        <span className="reg-pc-league">DPL <b>2026</b></span>
                        <span className="reg-pc-no">#{form.employee_id.trim() || '—'}</span>
                      </div>
                      <strong className="reg-pc-name">{form.name.trim() || 'Your player card'}</strong>
                      <span className="reg-pc-squad">{form.location} · {form.gender}</span>
                      <div className="reg-pc-tags">
                        <span className={form.dpl_played ? 'reg-pc-tag-dpl on' : 'reg-pc-tag-dpl'}>{form.dpl_played ? 'DPL VET' : 'DPL ROOKIE'}</span>
                      </div>
                      <div className="reg-pc-styles">
                        <span>{form.batting_style}</span>
                        <span>{form.bowling_style}</span>
                      </div>
                      <div className="reg-confirm-extra">
                        <div className="reg-confirm-extra-row"><span>EMAIL</span><b>{form.email.trim() || '—'}</b></div>
                        <div className="reg-confirm-extra-row"><span>SELF RATING</span><b>{'★'.repeat(form.self_rating)}{'☆'.repeat(5 - form.self_rating)}</b></div>
                        <div className="reg-confirm-extra-row"><span>AVAILABILITY</span><b>{form.availability}</b></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Stepper>

          {message ? <p className={`reg-message ${message.kind}`} role="status">{message.text}</p> : null}
          <small className="reg-note">Your details are used for DPL 2026 registration and team selection only.</small>
          </form>
        </BorderGlow>
      </main>
      <footer>DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET</footer>
    </div>
  );
}
