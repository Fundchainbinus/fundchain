-- FundChain — pemicu cron tick lewat Supabase pg_cron + pg_net (BFD-128, D-017, issue #34).
--
-- Menggantikan GitHub Actions `cron-tick.yml` sebagai pemicu utama (GitHub hanya menjalankannya tiap 5–11 jam, D-015).
-- Jalankan sekali di Supabase SQL Editor (project Fundchain). Aman dijalankan ulang (idempoten).
--
-- Secret TIDAK ada di file ini. Pemilik akun mengisinya sendiri ke Supabase Vault (langkah 0 di docs/infra/CRON-SCHEDULER.md):
--   select vault.create_secret('<nilai CRON_SECRET di Vercel>', 'fundchain_cron_secret');
--   select vault.create_secret('<URL webhook Discord>',          'fundchain_alert_webhook_url');  -- opsional, untuk alarm
--
-- Isi:
--   1. fundchain_ops.cron_tick()       — GET /api/v1/cron/tick dengan Authorization: Bearer <secret dari Vault>; tiap 5 menit.
--   2. fundchain_ops.tick_watchdog()   — alarm Discord bila tick terakhir (system_state.last_tick_at) > 30 menit; tiap 10 menit,
--                                        paling sering sekali per jam.
-- Schema `fundchain_ops` tidak diekspos PostgREST dan EXECUTE dicabut dari anon/authenticated (D-003).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists fundchain_ops;
revoke all on schema fundchain_ops from public, anon, authenticated;

create or replace function fundchain_ops.cron_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  request_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'fundchain_cron_secret' limit 1;
  if secret is null or secret = '' then
    raise warning 'fundchain_cron_secret belum ada di Vault: tick dilewati';
    return null;
  end if;
  -- maxDuration function Vercel 60 dtk; pg_net menyimpan status respons di net._http_response.
  select net.http_get(
    url := 'https://fundchain-api.vercel.app/api/v1/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 58000
  ) into request_id;
  return request_id;
end;
$$;

create or replace function fundchain_ops.tick_watchdog()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamp;
  last_alert timestamp;
  webhook text;
  age_min int;
  msg text;
begin
  -- Kolom timestamp(3) Prisma disimpan sebagai UTC tanpa zona.
  select last_tick_at, last_stale_alert_at into last_at, last_alert from public.system_state where key = 'cron_tick';
  if last_at is not null and last_at > (now() at time zone 'utc') - interval '30 minutes' then
    return 'ok';
  end if;
  if last_alert is not null and last_alert > (now() at time zone 'utc') - interval '60 minutes' then
    return 'stale (sudah di-alert < 1 jam lalu)';
  end if;

  age_min := case when last_at is null then null
                  else floor(extract(epoch from ((now() at time zone 'utc') - last_at)) / 60)::int end;
  msg := '⚠️ FundChain: cron tick berhenti — tick terakhir '
         || coalesce(age_min::text || ' menit lalu', 'belum pernah tercatat')
         || '. Cek Supabase → Integrations → Cron (job fundchain-cron-tick) dan net._http_response.';

  select decrypted_secret into webhook from vault.decrypted_secrets where name = 'fundchain_alert_webhook_url' limit 1;
  if webhook is null or webhook = '' then
    raise warning '%', msg || ' (fundchain_alert_webhook_url belum ada di Vault, alert hanya tercatat di log cron)';
    return 'stale (tanpa webhook)';
  end if;

  perform net.http_post(
    url := webhook,
    body := jsonb_build_object('content', msg),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
  update public.system_state set last_stale_alert_at = now() at time zone 'utc' where key = 'cron_tick';
  return 'stale (alert terkirim)';
end;
$$;

revoke all on function fundchain_ops.cron_tick() from public, anon, authenticated;
revoke all on function fundchain_ops.tick_watchdog() from public, anon, authenticated;

-- cron.schedule dengan nama yang sama memperbarui job yang ada (pg_cron >= 1.4).
select cron.schedule('fundchain-cron-tick', '*/5 * * * *', $$select fundchain_ops.cron_tick()$$);
select cron.schedule('fundchain-tick-watchdog', '*/10 * * * *', $$select fundchain_ops.tick_watchdog()$$);

-- Pemeriksaan (read-only):
--   select jobname, schedule, active from cron.job where jobname like 'fundchain-%';
--   select status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
--   select status_code, created from net._http_response order by created desc limit 20;
--   select last_tick_at, last_tick_ms, last_tick_source, last_tick_ok from public.system_state;
--
-- Mematikan (mis. pindah scheduler):
--   select cron.unschedule('fundchain-cron-tick');
--   select cron.unschedule('fundchain-tick-watchdog');
