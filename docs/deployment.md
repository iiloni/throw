# Deploying Throw

The owner chose an **operator-owned deployment directory**, with examples maintained in
Throw. Neither app depends on the other's repository or release cadence. Production needs
Docker Engine with Compose v2 (including `--wait`), a domain and an HTTPS reverse proxy.
The web app requires a secure context for offline storage and service workers. Postgres and
Electric are private to the Docker network; expose only the app through HTTP/2 HTTPS.

## Throw alone

1. Create a directory such as `~/services/throw`, outside any checkout. Copy
   `docker-compose.yml` as `compose.yaml`, `.env.example` as `.env`, and
   `scripts/backup.sh`/`scripts/update.sh` beside it. Copy files from the chosen release
   revision, reviewing infrastructure changes on later upgrades.
2. Set `THROW_IMAGE=ghcr.io/iiloni/throw:stable` (or an exact version/digest),
   `BETTER_AUTH_URL=https://tasks.example.com`, and separate `BETTER_AUTH_SECRET`,
   `POSTGRES_PASSWORD`, and `ELECTRIC_SECRET` values. Generate each with
   `openssl rand -hex 32`; `chmod 600 .env`. Set `THROW_BIND_ADDRESS=127.0.0.1` behind a
   proxy on the same host. Back up `.env` securely outside the server.
3. Keep the Postgres, Electric and backup volumes in the example. Published images require
   the package to be public; see [release setup](releases.md). Before the first publication,
   build a checkout with `docker-compose.build.yml` instead (development instructions).
4. Point DNS and the proxy at host port 3100 (container port 3000), preserving Host and
   forwarding HTTPS scheme. If the proxy forwards client IPs, configure `TRUSTED_PROXIES`
   with its actual IP/CIDR rather than trusting arbitrary clients. Do not expose Postgres
   or Electric ports. Start and verify:

   ```bash
   docker compose pull --ignore-buildable
   docker compose up -d --wait
   curl --fail https://tasks.example.com/api/health
   ```

5. Create the first account before opening access generally: it becomes the server admin.
   Registration closes afterwards. Throw has no invitation UI yet; `REGISTRATION=open`
   deliberately permits further signups. Catch and Throw accounts are independent.
6. Make a backup, export it off the host and verify a restore in a disposable deployment
   before relying on it. Enable daily backups in Settings. Use `./update.sh` for updates.

For a Docker-connected Traefik proxy, remove the server's host port mapping, add only the
app to the proxy's external network, and configure a unique router/service name:

```yaml
services:
  app:
    networks: [default, proxy]
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.throw.rule=Host(`tasks.example.com`)
      - traefik.http.routers.throw.tls=true
      - traefik.http.routers.throw.tls.certresolver=letsencrypt
      - traefik.http.services.throw.loadbalancer.server.port=3000
networks:
  default: {}
  proxy:
    name: proxy
    external: true
```

Adapt the resolver and network to the proxy already installed. HTTPS, DNS and certificates
are operator configuration, not managed by the release workflow.

## Catch and Throw together

Copy the contents (including `.env.example`) of [deploy/combined](../deploy/combined) to
`~/services/catch-throw/`, rename `.env.example` to `.env`, and copy Throw's backup/update
helpers beside `compose.yaml`. This example is for a **new** cluster; adding it does not
move an existing Catch deployment or touch its data.

The topology is one `pgvector/pgvector:pg17` container (matching Catch's production image),
separate `catch` and `throw` databases/owners, `catch`/`throw` app services, and
`catch-electric`/`throw-electric` services. Each Electric has its own volume and explicit
`ELECTRIC_REPLICATION_STREAM_ID` (`catch`/`throw`), since logical slot names are cluster-wide.
See [Electric configuration](https://electric.ax/docs/sync/api/config#electric_replication_stream_id).
Each app migrates only its own database at startup. Accounts, auth/Electric secrets, backup
volumes, and Catch attachments remain separate. Catch's image still contains its attachment
and other services; Throw never accesses that database or directory.

Set `COMPOSE_PROFILES=catch,throw` for both, `catch` for Catch only, or `throw` for Throw only.
Fill all example credentials and URLs even for one profile, because Compose interpolates
all service definitions. Generate credentials independently with `openssl rand -hex 32`;
hex is safe in database URLs. `POSTGRES_PASSWORD` is the cluster administrator's password;
it is not given to either app. Plain app owners have CREATEDB for restore and REPLICATION
for Electric, with no superuser/CREATEROLE/host-file privileges and no normal CONNECT access
to the sibling database. Replication and shared resources still imply a shared administrative
trust boundary and shared outage/storage risks. Use separate Postgres containers when that
is unacceptable. Profile choice affects running apps; initialization creates both empty databases.

```bash
cd ~/services/catch-throw
chmod 600 .env
chmod +x init-databases.sh backup.sh update.sh
docker compose pull
docker compose up -d --wait
curl --fail http://127.0.0.1:3000/api/health  # Catch if enabled
curl --fail http://127.0.0.1:3100/api/health  # Throw if enabled
```

The example binds servers to loopback: proxy `notes.example.com` to 3000 and
`tasks.example.com` to 3100. For Docker Traefik, apply the preceding network pattern to
each app, replacing `app` with its service name and using separate router names/hostnames.
Keep both Electric services and Postgres off that external network.

Pin each image independently. Updating Throw changes only `THROW_IMAGE` and runs:

```bash
THROW_APP_SERVICE=throw ./update.sh
```

This backs up Throw, pulls only its image and recreates only its app service. Catch's
release/image and dependencies remain running. For Catch, use its own reviewed helper
adapted to target the `catch` service, or explicitly run its backup CLI before
`docker compose pull catch && docker compose up -d --no-deps --wait catch`.
Throw's helper assumes Throw's backup CLI and must not be used against arbitrary services.
Infrastructure/Postgres/Electric upgrades are separate operator work; app releases do not
upgrade these automatically. Take both apps' backups before a shared Postgres change.

`init-databases.sh` runs only on an empty Postgres volume. Changing `.env` passwords does
not alter existing roles: rotate them through SQL and update the connections together.
Adding profiles later finds the already-created empty database. Maintain a stable Compose
project name and service/volume names across copies/upgrades.

To bring existing Catch data alongside Throw: first export a verified Catch backup and its
attachments, preserve its auth secret, initialize the new combined cluster, restore with
Catch's documented CLI, verify counts/login/files, then switch the proxy. Keep the old stack
stopped with its volumes intact until the new one is verified. This feature neither modifies
Catch nor performs that migration. Do not attach its existing Postgres volume to a new
initializer and expect database/role creation to rerun.

Preview deployments use a separate Compose project, hostnames, databases and Electric
volumes. They never share production app databases. See [backups and rollback](backups.md)
for per-database recovery: deleting the combined Postgres volume would delete both apps.
