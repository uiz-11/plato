# Plato

A personal learning app for one learner. Courses are written offline by the course pipeline and committed to `content/`. Progress is kept in one SQLite file. The design is in [`docs/v1/technical-design.md`](docs/v1/technical-design.md), and the course pipeline is in [`docs/v1/course-pipeline.md`](docs/v1/course-pipeline.md).

## Development

Node 24 (see `.nvmrc`).

```bash
npm ci
npm run dev                # http://localhost:3000, database at ./plato.db
npm run dev:fixtures       # the same, with the e2e fixture courses
```

With no `PLATO_PASSCODE` set, development has no passcode gate.

| Command | What it does |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm test` | ESLint, TypeScript, Vitest |
| `npm run build` | The standalone server in `.next/standalone/` |
| `npm run e2e` | Playwright against the built standalone server (build first) |
| `npm run content:check` | The content checks CI runs (§5.6, §11.4) |
| `npm run db:backup`, `npm run db:restore` | See [Backups](#backups) |

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `PLATO_DB_PATH` | production (absolute) | The SQLite file. The image sets `/data/plato.db`. Development defaults to `plato.db`. |
| `PLATO_PASSCODE` (≥ 20 characters), `PLATO_COOKIE_SECRET` | production | The passcode gate, and the pipeline's bearer token |
| `PLATO_TIME_ZONE` | no (default `UTC`) | The learner's IANA time zone. A day starts at 04:00 local time. |
| `PLATO_URL` | operator machine only | The app's URL, for `npm run requests:export` |
| `PLATO_CONTENT_DIR` | no (default `<app root>/content`) | The content root |
| `PLATO_TEST_HOOKS` | tests only | Never set it on a deployed instance |

The server checks the environment at start-up. If something is wrong, it lists every problem and exits with status 1 instead of serving requests. In production it also warns if the database's directory is not a mounted volume, because the data would be lost when the container is replaced.

## Deployment

The app runs as **one** container, always on, with the database on a persistent volume. SQLite has one writer, so never run two instances. The `Dockerfile` builds the image, and the server applies database migrations at start-up.

### Fly.io

`fly.toml` describes one machine that never auto-stops, with a volume `plato_data` mounted at `/data` and daily snapshots kept for 30 days.

First deploy:

```bash
fly launch --no-deploy --copy-config    # pick an app name and region; update fly.toml
```

```bash
fly volumes create plato_data --size 1 --region <region>
```

```bash
fly secrets set PLATO_PASSCODE="$(openssl rand -base64 24)" PLATO_COOKIE_SECRET="$(openssl rand -base64 32)"
```

```bash
fly deploy
```

Keep the passcode in your password manager. You need it to unlock the app and, as `PLATO_PASSCODE`, for `requests:export`. Set `PLATO_TIME_ZONE` in `fly.toml` under `[env]`.

Later deploys, for new courses or code: merge to `main` when CI is green, then run `fly deploy`. Content ships in the image, and the database stays on the volume.

Check that the app runs on one machine with the volume attached:

```bash
fly status
```

```bash
fly volumes list
```

### Other hosts

Run the image with a persistent volume at `/data`, the two secrets, and port 3000:

```bash
docker run -d --restart unless-stopped -p 3000:3000 -v plato-data:/data -e PLATO_PASSCODE=… -e PLATO_COOKIE_SECRET=… plato
```

Turn on the provider's daily snapshots for that volume. Run one instance only, and keep it running.

## Backups

There are two kinds of backup:

1. **Volume snapshots** are the primary backup. Fly snapshots volumes daily; `fly.toml` keeps them for 30 days. On other hosts, turn on the provider's snapshot feature.
2. **Backup files**, from `npm run db:backup`, are for manual backups (before a risky change, or to keep a copy off the host) and for restore drills. It writes a consistent copy with `VACUUM INTO`, which is safe while the server runs, and checks the copy.

Locally:

```bash
npm run db:backup                     # backups/plato-<timestamp>.db beside the database
```

```bash
npm run db:backup -- ~/plato-before-upgrade.db
```

On Fly, the image includes the backup and restore scripts, so run them in the container and download the file:

```bash
fly ssh console -C "node scripts/db-backup.ts /data/backups/plato-manual.db"
```

```bash
fly sftp get /data/backups/plato-manual.db ./plato-manual.db
```

Backups written to `/data/backups/` stay on the volume, so its snapshots include them. Delete old ones from time to time with `fly ssh console`.

To take an extra volume snapshot now:

```bash
fly volumes snapshots create <volume id>
```

## Restore

### From a backup file

`db:restore` checks the backup and stages it as `<PLATO_DB_PATH>.restore`. It refuses a backup made by a newer version of Plato than the one that is running. The server swaps the staged file in at its next start. It folds the current database's WAL into the main file and moves it aside as `plato.db.pre-restore-<timestamp>`, so you can undo the restore. Then it applies any newer migrations to the restored file. The live file is never replaced while the server has it open.

Restart within an hour of staging. An older staged file is not applied: the server renames it to `plato.db.restore-expired-<timestamp>` and logs a warning, so a forgotten restore can't roll the data back at some later restart. To cancel a staged restore, delete `plato.db.restore`. A restore also works over a corrupt database: if the current file cannot be checkpointed, it is moved aside as it is, with its `-wal` and `-shm` files. If the staged file turns out not to be a database this version can read, the server renames it to `plato.db.restore-rejected-<timestamp>`, logs why, and starts with the current database.

Locally, with the server stopped or running:

```bash
npm run db:restore -- backups/plato-2026-11-25T10-00-00-000Z.db
```

Then restart the server.

On Fly, upload the file, stage it, and restart the machine:

```bash
fly ssh sftp shell                    # then: put ./plato-manual.db /data/backups/plato-manual.db
```

```bash
fly ssh console -C "node scripts/db-restore.ts /data/backups/plato-manual.db"
```

```bash
fly machine restart <machine id>
```

`fly logs` shows `Restored the database from /data/plato.db.restore` at start-up. To undo, stage the `pre-restore` file the same way and restart again. When you are sure, delete the `pre-restore` files.

### From a volume snapshot

A snapshot restores into a new volume. You then move the machine onto that volume:

```bash
fly volumes list                                  # the current volume's id
```

```bash
fly volumes snapshots list <volume id>            # pick a snapshot
```

```bash
fly volumes create plato_data --snapshot-id <snapshot id> --size 1 --region <region>
```

```bash
fly machine list                                  # the current machine's id
```

```bash
fly machine clone <machine id> --region <region> --attach-volume <new volume id>:/data
```

```bash
fly machine destroy <old machine id> --force
```

Before you destroy the old machine, unlock the new one and check that the data is there. Keep the old volume until you are sure, then remove it with `fly volumes destroy <old volume id>`, which cannot be undone. To get a backup file from a snapshot instead, attach the restored volume to a machine and run `node scripts/db-backup.ts` there with `PLATO_DB_PATH` set to that volume's `plato.db`. Then download the backup with `fly sftp get`. Never copy `plato.db` by itself: recent writes may still be in `plato.db-wal`, and a copy of the main file alone leaves them out.

### Restore drill

`scripts/docker-drill.sh` runs in CI against the image. It checks that data survives a restart and a new container on the same volume, and that a `db:backup` restores with `db:restore` and a restart. Run it locally after `docker build -t plato:ci .`. Do a real drill on the deployed app at least once, and again after any change to this procedure. Use a manual backup, `db:restore`, a restart, and a check in the app.
