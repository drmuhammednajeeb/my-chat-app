# Database SQL archive

This directory is **non-executable historical material**. Supabase CLI migration discovery is restricted to `supabase/migrations/`.

- `source-provenance/`: original compound or repaired source files retained only to document provenance.
- `pending-forward-reconciliation/`: changes observed in production or pending review that are not part of the 62-version production migration ledger.
- `unapplied/`: proposals that are not represented as applied production migrations.

Never apply, glob, concatenate, or replay SQL from this archive. Every production migration candidate must be reviewed in `supabase/migrations/` and separately validated before any execution authorization.
