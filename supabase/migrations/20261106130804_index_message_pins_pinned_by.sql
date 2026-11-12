-- Separate production migration: message pin author index.
create index if not exists message_pins_pinned_by_idx on public.message_pins(pinned_by);
