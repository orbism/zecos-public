# ZEC-OS

A retro desktop for Zcash: block explorer, chain statistics and charts, privacy tools, messaging,
media and games, all in the browser, on live chain data.

The hosted version lives at [zec-os.com](https://zec-os.com). This repository is the open-source
core of it. Some parts of the hosted version are not included here.

## Licence

[AGPL-3.0](LICENSE). If you run a modified copy as a service, you must publish your changes.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md): your first pull request asks
you to sign a short contributor licence agreement.

## Requirements

- Node 20+ and npm
- PostgreSQL (accounts and Zcash ownership verification are server-side)
- A Zcash chain data API (`ZEC_API_URL`) and a Zaino or lightwalletd gRPC endpoint (`ZAINO_GRPC_URL`)
- A Zcash wallet address to receive verification payments

## Setup

```bash
npm install
cp apps/backend/.env.example apps/backend/.env     # fill it in
cp apps/frontend/.env.example apps/frontend/.env.local
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
npx prisma generate --schema apps/backend/prisma/schema.prisma
npm run dev
```

`apps/frontend` is the Next.js UI and proxies `/api/*` to the backend at `FASTIFY_URL`
(default `http://localhost:4000`). `apps/backend` is the Fastify API with Prisma. There are no
built-in chain hosts: point `ZEC_API_URL` and `ZAINO_GRPC_URL` at your own.

Each `.env.example` lists every variable that app reads.

## Running a deployment

The verified account at `ADMIN_ADDRESS` is the deployment's sysop and has some limited
moderation tools, plus a System Debugger showing traffic and recent errors. Set the sysop's
display name as `ADMIN_HANDLE` (backend) and `NEXT_PUBLIC_ADMIN_HANDLE` (frontend); it is
reserved for that address.

## Support

If ZEC-OS is useful to you, a donation to the address in the About app keeps it going.
