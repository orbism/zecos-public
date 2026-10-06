# Contributing

Thanks for helping. A few things keep this smooth:

1. **Sign the CLA.** Your first pull request asks you to sign a short contributor licence
   agreement (CLA Assistant, one click with GitHub). It lets your work be used in both this
   repository and the hosted ZEC-OS.
2. **Keep pull requests small and focused.** One fix or feature per pull request.
3. **Check it builds.** `npx tsc --noEmit` in `apps/frontend` and `apps/backend`.
4. **Schema changes** come as a new Prisma migration (`npx prisma migrate dev --name <name>`),
   never `db push`, and only add things: no dropped tables or columns.
5. **No secrets** in code, tests or examples.

Bugs and ideas: open an issue.
