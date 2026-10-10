import { writeFileSync } from 'node:fs';
import { createSeed } from '../docs/seed.js';
const seed=createSeed();
const definitions=[
  ['trips',[seed.trip],'id uuid,title text,start_date date,end_date date,timezone text'],
  ['participants',seed.participants,'id uuid,trip_id uuid,name text,active boolean'],
  ['lodgings',seed.lodgings,'id uuid,trip_id uuid,city text,name text,check_in date,check_out date,url text,notes text,verified boolean'],
  ['schedule_items',seed.schedule,'id uuid,trip_id uuid,date date,position integer,kind text,title text,description text,start_time time,end_time time,verified boolean,lodging_id uuid'],
  ['polls',seed.polls,'id uuid,trip_id uuid,schedule_id uuid'],
  ['candidates',seed.candidates,'id uuid,trip_id uuid,poll_id uuid,name text,url text,price integer,description text,hidden boolean,created_by uuid,created_at timestamptz'],
];
const sql=definitions.map(([table,rows,fields])=>{
  const names=fields.split(',').map(f=>f.trim().split(' ')[0]).join(',');
  return `insert into public.${table} (${names})\nselect ${names} from jsonb_to_recordset($seed$${JSON.stringify(rows)}$seed$::jsonb) as s(${fields})\non conflict(id) do nothing;`;
}).join('\n\n');
writeFileSync(new URL('../supabase/seed.sql',import.meta.url),`-- Generated from docs/seed.js. Re-running preserves existing edits and votes.\nbegin;\n${sql}\ncommit;\n`);
console.log('Generated supabase/seed.sql');
