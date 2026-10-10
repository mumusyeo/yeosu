import { readFileSync, writeFileSync } from 'node:fs';
const root=new URL('../',import.meta.url);
const files=['supabase/migrations/001_trip.sql','supabase/migrations/002_shared_expenses.sql','supabase/seed.sql'];
const body=files.map(file=>`-- Source: ${file}\n${readFileSync(new URL(file,root),'utf8').replace(/^\s*(?:begin|commit);\s*$/gmi,'')}`).join('\n\n');
const sql=`-- Generated: npm run build. ONLY for an empty project; use migrations for upgrades.
-- Paste this entire file into the Supabase SQL Editor and run once.
begin;
do $$ begin
  if to_regclass('public.trips') is not null then
    raise exception 'Travel tables already exist. Apply only unapplied migrations; do not re-run setup.sql.';
  end if;
end $$;
${body}
commit;

-- Copy each returned URL for that friend. Tokens are generated in the database.
select p.name as friend,
  'https://mumusyeo.github.io/yeosu/#invite=' || trip_private.bootstrap_invite(p.trip_id,p.id) as invite_url
from public.participants p
where p.trip_id='a0000000-0000-4000-8000-000000000001'::uuid and p.active
order by p.id;
`;
writeFileSync(new URL('supabase/setup.sql',root),sql);
console.log('Built supabase/setup.sql: atomic fresh installation and first friend links.');
