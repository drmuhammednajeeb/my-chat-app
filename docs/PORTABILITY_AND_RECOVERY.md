# Portable Project Backup & Recovery

## Objective

Keep a recoverable, platform-independent copy of the **application source code and design** so the project can be moved away from GitHub or its current hosting provider without rebuilding it from memory.

This procedure protects Git history, branches, tags, tracked source files, styles, assets, documentation, and repository configuration that is committed to Git. It does **not** by itself back up Supabase records/storage, Vercel project settings, domains, secrets, or third-party account configuration.

## Three-copy rule

Maintain these copies independently:

1. **Primary remote:** the canonical GitHub repository.
2. **Local mirror:** a full bare Git mirror on a computer controlled by the project owner.
3. **Second independent copy:** a copy of the mirror bundle and source archive on a separate disk or an encrypted storage provider that is not the same GitHub account.

A copy stored only as another branch, release, or Actions artifact in the same GitHub account is not an independent backup.

## Create or refresh a backup

From a computer with Git installed and network access:

### macOS / Linux / Git Bash

```bash
bash scripts/backup-repo.sh
```

Optionally choose a destination:

```bash
bash scripts/backup-repo.sh /path/to/backup-folder
```

### Windows PowerShell

```powershell
.\scripts\backup-repo.ps1
```

Optionally choose a destination:

```powershell
.\scripts\backup-repo.ps1 -Destination 'D:\BizmindMakersBackups'
```

The scripts create or refresh:
- `my-chat-app.git/`: a bare mirror containing all fetched branches and tags.
- `my-chat-app-YYYYMMDD-HHMMSS.bundle`: a portable Git bundle containing all refs and history.
- `my-chat-app-source-YYYYMMDD-HHMMSS.zip` or `.tar.gz`: a snapshot of the repository's default-branch source tree.
- `backup-manifest.txt`: source URL, timestamp, default branch, and backup filenames.

The bundle is the portable Git recovery artifact. The source archive is a convenient inspection/deployment snapshot; it does not contain Git history.

## Verify and restore

The scripts run `git bundle verify` after creating the bundle. Keep the output and manifest together.

To restore the repository from a bundle on another computer:

```bash
git clone /path/to/my-chat-app-YYYYMMDD-HHMMSS.bundle my-chat-app
cd my-chat-app
git remote -v
```

Then add a new remote when moving to another Git provider:

```bash
git remote add origin <NEW_GIT_REMOTE_URL>
git push --all origin
git push --tags origin
```

Review the destination provider's branch protection, repository visibility, Actions/CI configuration, and large-file support before switching the team to the new remote. Keep the original mirror and bundle unchanged until the new remote has been verified.

## Moving the static frontend to another host

The current application is a static frontend with `index.html` at the repository root. The README is the source of truth for the currently documented runtime and hosting assumptions. Before changing hosts:

1. Import the Git repository or push the restored bundle to the new provider.
2. Configure the new host to serve the repository root as static files, unless a reviewed future change introduces a build system.
3. Recreate environment/configuration values through the new host's secure settings; never commit private values.
4. Configure Supabase Authentication Site URL and Redirect URLs for the new application domain.
5. Verify HTTPS, PWA/service-worker paths, cache versioning, and static asset paths.
6. Run the authenticated regression checklist in the README before switching the production domain.

Do not change the Supabase project URL, schema, RLS, Storage policies, or production data as part of a frontend hosting migration unless separately planned and approved.

## Items requiring separate protection

| Asset | Separate recovery method |
|---|---|
| Supabase database | Supabase-managed backups/PITR or a separately tested database export and restore |
| Supabase Storage | Separate object export/copy with path and ownership manifest |
| Supabase Auth users | Provider-supported migration/export plan; do not assume SQL export is sufficient |
| Vercel configuration/domains | Document settings and recreate securely on the destination host |
| Environment variables/secrets | Password manager or encrypted secret vault; never place in Git or plain backup archives |
| DNS/domain ownership | Registrar account access and DNS record inventory |

The existing in-app Backup & Restore module is for permitted account-level application data. It is not a substitute for a repository mirror or a full Supabase disaster-recovery plan.

## Security requirements

- Treat mirror folders, bundles, and archives as sensitive because Git history may contain accidentally committed secrets.
- Store off-device copies encrypted and restrict access.
- Do not put `.env`, service-role keys, passwords, access tokens, or private customer data in repository backups intended for sharing.
- If a secret was ever committed, rotate it. Removing it from the latest commit does not remove it from older Git history or bundles.
- Do not delete the previous known-good backup until the new backup passes verification and has been copied to the independent location.

## Recovery test cadence

- Refresh the mirror after meaningful milestones and at least weekly while active development continues.
- Keep at least one dated bundle off the development computer.
- Periodically clone a bundle into a temporary directory and inspect the branches/tags before relying on it.
- Record the tested bundle date and destination in the project operations log.
