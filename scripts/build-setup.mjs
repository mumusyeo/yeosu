import { readFileSync,writeFileSync } from 'node:fs';
const root=new URL('../',import.meta.url);
const read=file=>readFileSync(new URL('supabase/'+file,root),'utf8').replace(/\r\n/g,'\n').replace(/^\s*(?:begin|commit);\s*$/gmi,'');
const sql=`-- Generated: npm run build. Run the WHOLE file in the project SQL Editor.
-- Supports a new project and upgrades from v1/v2. Existing records and edits are retained.
begin;
do $install_base$
begin
  if to_regclass('public.trips') is null then
    execute $migration_001$${read('migrations/001_trip.sql')}$migration_001$;
  end if;
  if to_regclass('public.expenses') is null then
    execute $migration_002$${read('migrations/002_shared_expenses.sql')}$migration_002$;
  end if;
end;
$install_base$;
${read('seed.sql')}
do $install_nicknames$
begin
  if to_regprocedure('trip_private.require_trip(uuid)') is null then
    execute $migration_003$${read('migrations/003_nickname_board.sql')}$migration_003$;
  end if;
end;
$install_nicknames$;
${read('migrations/004_trip_details.sql')}
${read('migrations/005_expense_accounts.sql')}
${read('migrations/006_expense_banks.sql')}
commit;
select 'https://mumusyeo.github.io/yeosu/' as invitation_url,
  'Ready: shared nickname board. No Auth configuration or personal links needed.' as status;
`;
writeFileSync(new URL('supabase/setup.sql',root),sql.replace(/\r\n/g,'\n'));
console.log('Built supabase/setup.sql: install/upgrade shared nickname board; no Auth setup.');
