-- Run this in Supabase SQL Editor.

create table if not exists public.doodle_players (
  user_id text primary key,
  name text not null,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  games_played integer not null default 0,
  best_score integer not null default 0,
  total_score integer not null default 0,
  total_shots integer not null default 0,
  total_hits integer not null default 0,
  total_jumps integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.doodle_scores (
  id bigint generated always as identity primary key,
  user_id text not null references public.doodle_players(user_id) on delete cascade,
  score integer not null,
  max_height integer not null default 0,
  shots integer not null default 0,
  hits integer not null default 0,
  jumps integer not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists doodle_players_best_score_idx
  on public.doodle_players (best_score desc, updated_at asc);

create index if not exists doodle_scores_user_id_idx
  on public.doodle_scores (user_id);

alter table public.doodle_players enable row level security;
alter table public.doodle_scores enable row level security;

-- No public RLS policies are needed because the game server writes with a server-side secret/service key.
-- Do not put the secret/service key into browser JavaScript.
