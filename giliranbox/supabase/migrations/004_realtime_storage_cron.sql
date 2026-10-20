-- Realtime only where a screen is actively watching: active job, quotes, chat, queue.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table jobs, job_tracking, job_offers, quotes, messages, queue_tickets;
  end if;
end $$;

-- Broadcast channel for the shop TV display (ticket numbers only, no personal data): topic "shop:<uuid>".
create function trg_queue_broadcast() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status in ('called','serving') then
    perform realtime.send(jsonb_build_object('number', new.number, 'recall_at', new.called_at), 'call', 'shop:' || new.shop_id, false);
  end if;
  return new;
end $$;
do $$ begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    create trigger queue_broadcast after insert or update on queue_tickets for each row execute function trg_queue_broadcast();
  end if;
end $$;

-- Storage buckets (private job photos & licences; public CDN-served images).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('public-img',    'public-img',    true,  307200, array['image/webp']),
      ('job-photos',    'job-photos',    false, 307200, array['image/webp']),
      ('provider-docs', 'provider-docs', false, 819200, array['image/webp','application/pdf'])
    on conflict (id) do nothing;
    -- path convention: <bucket>/<uid>/<file>  (job-photos: <customer uid>/<job uuid>/<file>)
    create policy up_insert on storage.objects for insert to authenticated
      with check (bucket_id in ('job-photos','provider-docs') and (storage.foldername(name))[1] = auth.uid()::text);
    create policy up_read_own on storage.objects for select to authenticated
      using (bucket_id in ('job-photos','provider-docs') and (storage.foldername(name))[1] = auth.uid()::text);
    create policy up_read_job on storage.objects for select to authenticated
      using (bucket_id = 'job-photos' and can_see_job(((storage.foldername(name))[2])::uuid));
    create policy up_read_admin on storage.objects for select to authenticated using (is_admin());
    create policy pub_avatar on storage.objects for insert to authenticated
      with check (bucket_id = 'public-img' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- Server-side sweep every minute. The apps never poll; this widens instant searches and expires stale jobs.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('giliranbox-sweep', '* * * * *', 'select public.sweep_jobs()');
  end if;
end $$;
