create index if not exists member_invitations_created_by_idx
  on app_private.member_invitations(created_by);
create index if not exists member_invitations_accepted_by_idx
  on app_private.member_invitations(accepted_by);
