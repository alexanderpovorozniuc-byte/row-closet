-- Swap Row database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, and run it once.
--
-- How student-only access is enforced (none of it relies on the website's own code):
--   1. Every sign-up is checked against the school email domains in public.universities.
--      Anything else is rejected by the database before the account is created.
--   2. University of Alabama sign-ins go through Microsoft, pinned to UA's own tenant,
--      which hands off to UA's myBama/Okta login (see README). Other schools sign in
--      with a one-time code sent to their school email.
--   3. A user's university comes from their verified email, never from what they picked
--      on screen. Students only see listings from their own university.

create extension if not exists pgcrypto;

-- ---------- universities ----------
create table if not exists public.universities (
  id              text primary key,             -- short slug, e.g. 'ua'
  name            text not null,
  short_name      text not null,
  email_domains   text[] not null,              -- student email domains; subdomains also match
  sso_provider    text,                         -- 'azure' = sign in with the school's Microsoft/Okta login
  sso_domain_hint text,                         -- sends Microsoft straight to the school's login page
  sso_label       text,                         -- what students call that login, e.g. 'myBama'
  priority        int not null default 100,     -- lower shows first in the picker
  enabled         boolean not null default true
);

insert into public.universities (id, name, short_name, email_domains, sso_provider, sso_domain_hint, priority) values
  ('ua',      'The University of Alabama',     'Alabama',     '{crimson.ua.edu}',                'azure', 'crimson.ua.edu', 0),
  ('auburn',  'Auburn University',             'Auburn',      '{auburn.edu}',                    null, null, 10),
  ('olemiss', 'University of Mississippi',     'Ole Miss',    '{go.olemiss.edu}',                null, null, 10),
  ('msstate', 'Mississippi State University',  'Miss State',  '{msstate.edu}',                   null, null, 10),
  ('lsu',     'Louisiana State University',    'LSU',         '{lsu.edu}',                       null, null, 10),
  ('uga',     'University of Georgia',         'Georgia',     '{uga.edu}',                       null, null, 10),
  ('utk',     'University of Tennessee',       'Tennessee',   '{vols.utk.edu}',                  null, null, 10),
  ('uark',    'University of Arkansas',        'Arkansas',    '{uark.edu}',                      null, null, 10),
  ('uky',     'University of Kentucky',        'Kentucky',    '{uky.edu}',                       null, null, 10),
  ('sc',      'University of South Carolina',  'South Carolina', '{email.sc.edu}',               null, null, 10)
on conflict (id) do nothing;
update public.universities set sso_label = 'myBama' where id = 'ua' and sso_label is null;

-- Which university an email belongs to (exact domain or a subdomain of it), or null.
create or replace function public.university_for_email(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select u.id
  from public.universities u, unnest(u.email_domains) d
  where u.enabled
    and (split_part(lower(p_email), '@', 2) = lower(d)
         or split_part(lower(p_email), '@', 2) like '%.' || lower(d))
  order by u.priority
  limit 1
$$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  university_id text not null references public.universities (id),
  display_name  text not null default '' check (char_length(display_name) <= 40),
  chapter       text not null default '' check (char_length(chapter) <= 60),
  contact       text not null default '' check (char_length(contact) <= 80),
  created_at    timestamptz not null default now()
);

-- Block sign-ups from non-student emails, before the account exists.
create or replace function public.enforce_student_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or public.university_for_email(new.email) is null then
    raise exception 'Swap Row is for students only. Sign up with your university email.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_student_email on auth.users;
create trigger enforce_student_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_student_email();

-- Give every new account a profile tied to the university of its verified email.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, university_id)
  values (new.id, public.university_for_email(new.email))
  on conflict (id) do update set university_id = excluded.university_id;
  return new;
end $$;

drop trigger if exists create_profile_for_user on auth.users;
create trigger create_profile_for_user
  after insert or update of email on auth.users
  for each row execute function public.create_profile_for_user();

-- The signed-in student's university (null when signed out).
create or replace function public.my_university()
returns text language sql stable security definer set search_path = public as $$
  select university_id from public.profiles where id = auth.uid()
$$;

-- ---------- listings ----------
create table if not exists public.listings (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  university_id text not null references public.universities (id),
  title         text not null check (char_length(title) between 1 and 90),
  category      text not null default 'Other' check (char_length(category) <= 40),
  size          text not null default '' check (char_length(size) <= 20),
  condition     text not null default '' check (char_length(condition) <= 40),
  price         int  not null check (price between 1 and 9999),
  events        text[] not null default '{}' check (cardinality(events) <= 10),
  description   text not null default '' check (char_length(description) <= 1200),
  photos        text[] not null default '{}' check (cardinality(photos) <= 4),
  status        text not null default 'available' check (status in ('available', 'pending', 'sold')),
  created_at    timestamptz not null default now()
);
create index if not exists listings_university_created on public.listings (university_id, created_at desc);

-- A listing always belongs to its seller's university, whatever the client sends.
create or replace function public.stamp_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.seller_id := auth.uid();
  new.university_id := public.my_university();
  if new.university_id is null then
    raise exception 'Only signed-in students can post listings.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists stamp_listing on public.listings;
create trigger stamp_listing before insert on public.listings
  for each row execute function public.stamp_listing();

-- ---------- row level security ----------
alter table public.universities enable row level security;
alter table public.profiles     enable row level security;
alter table public.listings     enable row level security;

drop policy if exists "universities are public" on public.universities;
create policy "universities are public" on public.universities
  for select to anon, authenticated using (enabled);

drop policy if exists "classmates see profiles" on public.profiles;
create policy "classmates see profiles" on public.profiles
  for select to authenticated using (university_id = public.my_university());

drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "classmates see listings" on public.listings;
create policy "classmates see listings" on public.listings
  for select to authenticated using (university_id = public.my_university());

drop policy if exists "post own listings" on public.listings;
create policy "post own listings" on public.listings
  for insert to authenticated with check (seller_id = auth.uid());

drop policy if exists "edit own listings" on public.listings;
create policy "edit own listings" on public.listings
  for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());

drop policy if exists "delete own listings" on public.listings;
create policy "delete own listings" on public.listings
  for delete to authenticated using (seller_id = auth.uid());

-- Students can change their own details, never their university or a listing's owner.
revoke all on public.universities from anon, authenticated;
revoke all on public.profiles     from anon, authenticated;
revoke all on public.listings     from anon, authenticated;
grant select on public.universities to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, chapter, contact) on public.profiles to authenticated;
grant select, delete on public.listings to authenticated;
grant insert (title, category, size, condition, price, events, description, photos, status) on public.listings to authenticated;
grant update (title, category, size, condition, price, events, description, photos, status) on public.listings to authenticated;

-- ---------- photo storage ----------
-- Public bucket: photo URLs are unguessable, and listings themselves stay students-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880, '{image/jpeg,image/png,image/webp}')
on conflict (id) do nothing;

drop policy if exists "students upload own photos" on storage.objects;
create policy "students upload own photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.my_university() is not null);

drop policy if exists "students delete own photos" on storage.objects;
create policy "students delete own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
