insert into public.workspaces (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Stage 1 Test Workspace')
on conflict (id) do update set name = excluded.name;
