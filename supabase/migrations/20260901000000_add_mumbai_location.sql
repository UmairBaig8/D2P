-- Add Mumbai as a supported registration location.
alter table public.registrations
  drop constraint if exists registrations_location_check;

alter table public.registrations
  add constraint registrations_location_check check (location in ('CZ', 'SP', 'Mumbai', 'Other'));
