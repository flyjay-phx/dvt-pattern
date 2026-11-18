-- 디어밸리 터치앤고 착륙 기록. 여러 번 실행해도 기존 기록은 그대로 둔다.
create table if not exists dvt_landings (
  id bigserial primary key,
  pilot text not null check (char_length(pilot) between 1 and 16),
  tail text not null,
  runway text not null check (runway in ('07R','25L','07L','25R')),
  kind text not null check (kind in ('touch_and_go','full_stop')),
  mode text not null default 'normal' check (mode in ('normal','crosswind','engine_out')),
  sink_fpm integer not null,
  centerline_ft integer not null,
  from_threshold_ft integer not null,
  ias_kt integer not null,
  crab_deg integer not null,
  bank_deg integer not null,
  checklist boolean not null default false,
  wind_text text not null default '',
  sim_hour real,
  flight_time_s integer not null default 0,
  score integer not null,
  grade text not null,
  track jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dvt_landings_score_idx on dvt_landings (score desc);
create index if not exists dvt_landings_created_idx on dvt_landings (created_at desc);
create index if not exists dvt_landings_pilot_idx on dvt_landings (pilot);
