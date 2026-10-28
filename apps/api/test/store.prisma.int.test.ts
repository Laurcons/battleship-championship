import { PrismaStore } from '../src/store/prisma.js';
import { describeStoreContract } from './helpers/storeContract.js';
import { createTestDatabase } from './helpers/testDb.js';

describeStoreContract('prisma/mariadb', async () => {
  const db = await createTestDatabase();
  return { store: new PrismaStore({ databaseUrl: db.url }), cleanup: db.cleanup };
});
