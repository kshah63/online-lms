-- ============================================================================
-- 0011_rate_limits.sql — server-side rate limiting for AI + public endpoints
-- ----------------------------------------------------------------------------
-- A small fixed-window counter table + an atomic SECURITY DEFINER function so
-- limits hold ACROSS serverless instances (an in-memory limiter would reset on
-- every cold start and never see sibling invocations). Used to cap AI spend
-- (live coach, post-session analysis, report drafts) and to throttle the one
-- unauthenticated endpoint we expose (public account requests).
-- ============================================================================

create table if not exists rate_limits (
  bucket       text        not null,        -- e.g. "ai:coach_live:<uid>", "acct_req:<ip>"
  window_start timestamptz not null,        -- start of the fixed window
  count        int         not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);

-- Locked down: only the SECURITY DEFINER function (running as owner) and the
-- service role touch this table. No policies for anon/authenticated.
alter table rate_limits enable row level security;

-- Atomic "spend one" against a fixed window. Returns TRUE when the call is
-- within the limit, FALSE when it should be rejected. Increments either way so
-- a flood keeps tripping until the window rolls over.
create or replace function public.rl_check(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
) returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count        int;
begin
  -- Snap "now" down to the start of its window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits as rl (bucket, window_start, count)
    values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
    do update set count = rl.count + 1
  returning rl.count into v_count;

  -- Opportunistic GC: ~1% of calls sweep windows older than a day.
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- Callable by both unauthenticated (account requests) and signed-in (AI) paths.
grant execute on function public.rl_check(text, int, int) to anon, authenticated, service_role;

-- Reload PostgREST's schema cache so rpc('rl_check', …) resolves immediately.
notify pgrst, 'reload schema';
