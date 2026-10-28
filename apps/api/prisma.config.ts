import { defineConfig } from 'prisma/config';

// Without DATABASE_URL the placeholder fails to connect, rather than reaching a real database by accident.
const url = process.env.DATABASE_URL ?? 'mysql://unset:unset@127.0.0.1:1/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
