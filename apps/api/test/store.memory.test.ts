import { MemoryStore } from '../src/store/memory.js';
import { describeStoreContract } from './helpers/storeContract.js';

describeStoreContract('memory', async () => ({ store: new MemoryStore(), cleanup: async () => {} }));
