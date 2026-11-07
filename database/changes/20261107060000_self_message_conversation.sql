-- Enforce one personal self-chat conversation per account.
create unique index if not exists conversations_one_self_chat_per_owner
on public.conversations (created_by)
where type = 'group' and description = 'bizmindmakers:self-chat:v1';
