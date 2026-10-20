-- GiliranBox demo seed: launch config (Petaling: PJ, Subang, Shah Alam; Aircond, Cleaning, Scrap), 10 providers, demo users, 2 shops.
-- Run AFTER migrations. Demo logins use Supabase test OTPs (see config.toml): any listed number + OTP 123456.

insert into regions (code, name, center, radius_km, enabled) values
 ('PJ',     'Petaling Jaya', pt(3.1073,101.6067), 9,  true),
 ('SUBANG', 'Subang Jaya',   pt(3.0565,101.5851), 8,  true),
 ('SHAH',   'Shah Alam',     pt(3.0733,101.5185), 12, true),
 ('KL',     'Kuala Lumpur',  pt(3.1390,101.6869), 15, false);

-- type: instant | scheduled | quote. Only the 3 launch categories are enabled; the rest stay hidden until an admin flips `enabled`.
insert into categories (slug, name, icon, booking_type, enabled, is_scrap, commission_pct, from_price_cents, price_label, license_kind, repeat_days, sort) values
 ('aircond',  '{"en":"Aircond servicing","ms":"Servis aircond","zh":"冷气保养"}',                'ac_unit',        'scheduled', true,  false, 15, 6000, '{"en":"Wall unit from","ms":"Unit dinding dari","zh":"壁挂式起价"}', null, 120, 10),
 ('cleaning', '{"en":"House cleaning","ms":"Pembersihan rumah","zh":"家居清洁"}',               'cleaning_services','scheduled',true, false, 15, 8000, '{"en":"From (2 hours)","ms":"Dari (2 jam)","zh":"起价（2小时）"}', null, 7, 20),
 ('scrap',    '{"en":"Scrap & recycling pickup","ms":"Kutipan besi buruk & kitar semula","zh":"废品回收上门"}','recycling','instant', true,  true,  10, null, '{"en":"We pay you per kg","ms":"Kami bayar ikut kg","zh":"按公斤付款给您"}', null, null, 30),
 ('plumber',  '{"en":"Plumber","ms":"Tukang paip","zh":"水喉工"}',                              'plumbing',       'instant',   false, false, 15, 5000, null, null, null, 40),
 ('electrician','{"en":"Electrician","ms":"Juruelektrik","zh":"电工"}',                         'electrical_services','instant',false,false,15,5000,null,'electrical_competency',null,50),
 ('locksmith','{"en":"Locksmith / key maker","ms":"Tukang kunci","zh":"锁匠"}',                  'key',            'instant',   false, false, 15, 4000, null, null, null, 60),
 ('movers',   '{"en":"Movers / lorry sewa","ms":"Lori sewa / pindah rumah","zh":"搬家/租罗里"}',   'local_shipping', 'quote',     false, false, 12, null, null, null, null, 70),
 ('pest',     '{"en":"Pest control","ms":"Kawalan perosak","zh":"灭虫"}',                        'pest_control',   'scheduled', false, false, 15, 15000, null, 'pest_license', 180, 80),
 ('handyman', '{"en":"Handyman / furniture assembly","ms":"Tukang am / pasang perabot","zh":"杂工/组装家具"}','handyman','quote',false,false,15,null,null,null,null,90),
 ('appliance','{"en":"Appliance repair","ms":"Baiki peralatan","zh":"家电维修"}',               'home_repair_service','quote',  false, false, 15, null, null, null, null, 100),
 ('watertank','{"en":"Water tank / filter cleaning","ms":"Cuci tangki air / penapis","zh":"水塔/滤水器清洗"}','water_drop','scheduled',false,false,15,12000,null,null,365,110),
 ('carwash',  '{"en":"Car wash at home","ms":"Cuci kereta di rumah","zh":"上门洗车"}',            'local_car_wash', 'scheduled', false, false, 15, 3000, null, null, 14, 120),
 ('mechanic', '{"en":"Mobile mechanic / battery / tyre","ms":"Mekanik bergerak / bateri / tayar","zh":"流动修车/电池/轮胎"}','car_repair','instant',false,false,15,8000,null,null,null,130),
 ('bulky',    '{"en":"Bulky waste disposal","ms":"Buang sampah besar","zh":"大件垃圾清运"}',       'delete_sweep',   'quote',     false, false, 12, null, null, null, null, 140),
 ('grass',    '{"en":"Grass cutting","ms":"Potong rumput","zh":"割草"}',                         'grass',          'scheduled', false, false, 15, 6000, null, null, 30, 150),
 ('laundry',  '{"en":"Laundry pickup","ms":"Kutipan dobi","zh":"洗衣取送"}',                      'local_laundry_service','scheduled',false,false,15,2000,null,null,7,160),
 ('barber',   '{"en":"Home barber / salon","ms":"Gunting rambut / salun di rumah","zh":"上门理发/美发"}','content_cut','scheduled',false,false,15,3500,null,null,30,170),
 ('upholstery','{"en":"Mattress / sofa / carpet cleaning","ms":"Cuci tilam / sofa / karpet","zh":"床垫/沙发/地毯清洗"}','weekend','scheduled',false,false,15,9000,null,null,180,180),
 ('painting', '{"en":"Painting","ms":"Mengecat","zh":"油漆"}',                                    'format_paint',   'quote',     false, false, 12, null, null, null, null, 190),
 ('tuition',  '{"en":"Home tuition","ms":"Tuisyen di rumah","zh":"家教"}',                       'school',         'scheduled', false, false, 15, 4000, null, null, null, 200);

insert into scrap_rates (item_type, name, cents_per_kg) values
 ('paper',     '{"en":"Paper / newspaper","ms":"Kertas / suratkhabar","zh":"纸张/报纸"}', 25),
 ('cardboard', '{"en":"Cardboard","ms":"Kadbod","zh":"纸皮"}', 30),
 ('plastic',   '{"en":"Plastic","ms":"Plastik","zh":"塑料"}', 40),
 ('iron',      '{"en":"Iron / steel","ms":"Besi / keluli","zh":"铁/钢"}', 90),
 ('aluminium', '{"en":"Aluminium / cans","ms":"Aluminium / tin","zh":"铝/罐"}', 350),
 ('copper',    '{"en":"Copper","ms":"Tembaga","zh":"铜"}', 2500),
 ('ewaste',    '{"en":"E-waste (non-working)","ms":"Sisa elektronik","zh":"电子废料"}', 50);

insert into promos (id, title, code, category_id, discount_pct) values
 (gen_random_uuid(), '{"en":"RM10 off your first aircond service","ms":"Diskaun RM10 servis aircond pertama","zh":"首次冷气保养减RM10"}', 'AIRCOND10', 1, null),
 (gen_random_uuid(), '{"en":"Get paid for your old newspapers","ms":"Dapat duit dari suratkhabar lama","zh":"旧报纸换现金"}', null, 3, null);

-- ---------- demo auth users (Supabase: inserting into auth.users fires handle_new_user -> profiles) ----------
create temp table demo(id uuid, phone text, name text, role user_role, lang text, lat double precision, lng double precision, area text);
insert into demo values
 -- admin, customers, shop staff
 ('00000000-0000-4000-8000-000000000001','+60123456001','Admin GiliranBox','admin','en',null,null,null),
 ('00000000-0000-4000-8000-000000000002','+60123456002','Aisyah Rahman','customer','ms',null,null,null),
 ('00000000-0000-4000-8000-000000000003','+60123456003','Tan Mei Ling','customer','zh',null,null,null),
 ('00000000-0000-4000-8000-000000000004','+60123456004','Counter Staff','customer','en',null,null,null),
 -- 10 providers around Petaling Jaya / Subang / Shah Alam
 ('00000000-0000-4000-8000-000000000101','+60123457001','Ahmad Faizal',   'provider','ms',3.1005,101.6370,'Seksyen 14, PJ'),
 ('00000000-0000-4000-8000-000000000102','+60123457002','Lim Kok Wai',    'provider','zh',3.1186,101.6224,'SS2, PJ'),
 ('00000000-0000-4000-8000-000000000103','+60123457003','Suresh Kumar',   'provider','en',3.1344,101.6226,'Damansara Utama'),
 ('00000000-0000-4000-8000-000000000104','+60123457004','Nurul Huda',     'provider','ms',3.1043,101.6040,'Kelana Jaya'),
 ('00000000-0000-4000-8000-000000000105','+60123457005','Wong Siew Fong', 'provider','zh',3.0759,101.5886,'SS15, Subang Jaya'),
 ('00000000-0000-4000-8000-000000000106','+60123457006','Mohd Hafiz',     'provider','ms',3.0472,101.5880,'USJ, Subang Jaya'),
 ('00000000-0000-4000-8000-000000000107','+60123457007','Rajendran',      'provider','en',3.0733,101.5185,'Seksyen 7, Shah Alam'),
 ('00000000-0000-4000-8000-000000000108','+60123457008','Siti Aminah',    'provider','ms',3.1475,101.6157,'Bandar Utama'),
 ('00000000-0000-4000-8000-000000000109','+60123457009','Chong Wei Han',  'provider','en',3.0731,101.6067,'Sunway, PJ'),
 ('00000000-0000-4000-8000-000000000110','+60123457010','Kamarul Zaman',  'provider','ms',3.1558,101.6086,'Mutiara Damansara');

insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', replace(phone,'+',''), now(), '{"provider":"phone","providers":["phone"]}', '{}', now(), now() from demo;

update profiles p set full_name = d.name, role = d.role, lang = d.lang, phone = d.phone,
       pdpa_consent_at = now(), pdpa_version = '2026-01' from demo d where d.id = p.id;

-- providers: 1-4 aircond, 5-7 cleaning, 8-10 scrap (some overlap); #110 is PENDING approval; #106,#109 offline
insert into providers (id, status, ic_last4, ic_verified, bio, radius_km, online, last_geog, last_seen, rating_avg, rating_count, jobs_done)
select id,
       case when right(id::text,3) = '110' then 'pending'::provider_status else 'approved' end,
       lpad((row_number() over (order by id))::text, 4, '1'), right(id::text,3) <> '110',
       'Berpengalaman 5 tahun / 5 years experience. ' || area, 12 + (row_number() over (order by id) % 4) * 3,
       right(id::text,3) not in ('106','109','110'), pt(lat, lng), now(),
       round((4.3 + (row_number() over (order by id) % 7) / 10.0)::numeric, 2), 20 + (row_number() over (order by id)) * 7, 30 + (row_number() over (order by id)) * 11
  from demo where role = 'provider';

insert into provider_categories (provider_id, category_id, from_price_cents)
select p.id, c.id, case c.slug when 'aircond' then 5500 + (right(p.id::text,2)::int % 5) * 500 when 'cleaning' then 7500 + (right(p.id::text,2)::int % 4) * 500 end
  from providers p join categories c on c.slug = case
    when right(p.id::text,3) in ('101','102','103','104') then 'aircond'
    when right(p.id::text,3) in ('105','106','107')       then 'cleaning'
    else 'scrap' end;
insert into provider_categories (provider_id, category_id, from_price_cents)   -- overlaps: 103 also scrap, 105 also aircond, 108 also cleaning
select '00000000-0000-4000-8000-000000000103'::uuid, id, null::int from categories where slug = 'scrap'
union all select '00000000-0000-4000-8000-000000000105', id, 6500 from categories where slug = 'aircond'
union all select '00000000-0000-4000-8000-000000000108', id, 8000 from categories where slug = 'cleaning';

insert into provider_prices (provider_id, category_id, item, price_cents)
select '00000000-0000-4000-8000-000000000101'::uuid, id, x.item, x.p from categories, (values ('Wall unit 1.0-1.5HP service',6000),('Wall unit chemical wash',15000),('Gas top-up R32',12000)) x(item,p) where slug = 'aircond'
union all select '00000000-0000-4000-8000-000000000105', id, x.item, x.p from categories, (values ('2-hour clean',8000),('4-hour deep clean',15000)) x(item,p) where slug = 'cleaning';

-- demo customer address & a finished job so "Book again" has content
insert into addresses (user_id, label, line, geog) values
 ('00000000-0000-4000-8000-000000000002','Home','No. 12, Jalan SS 2/24, 47300 Petaling Jaya', pt(3.1190,101.6200)),
 ('00000000-0000-4000-8000-000000000003','Home','Blok B, Pangsapuri USJ 10, 47620 Subang Jaya', pt(3.0490,101.5860));

with j as (
  insert into jobs (customer_id, provider_id, category_id, type, status, region_code, area_geog, price_cents, commission_cents, pay_status, created_at, accepted_at, done_at)
  select '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102', id, 'scheduled','done','PJ', snap_area(pt(3.1190,101.6200)), 6000, 900,'paid',
         now() - interval '40 days', now() - interval '40 days', now() - interval '39 days' from categories where slug = 'aircond' returning id)
insert into job_private (job_id, address_line, geog, contact_phone)
select id, 'No. 12, Jalan SS 2/24, 47300 Petaling Jaya', pt(3.1190,101.6200), '+60123456002' from j;

-- ---------- queue demo shops ----------
insert into shops (id, owner_id, name, kind, address, geog, avg_service_secs) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','Gunting Rambut Ah Seng','barber','SS2, Petaling Jaya', pt(3.1186,101.6230), 900),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','Bengkel Maju Motor','workshop','Seksyen 14, Petaling Jaya', pt(3.1010,101.6360), 1200),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','Farmasi Sihat (counter queue)','pharmacy','Bandar Utama', pt(3.1480,101.6150), 240);
insert into shop_staff select id, '00000000-0000-4000-8000-000000000004' from shops;
