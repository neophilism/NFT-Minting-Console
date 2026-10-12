import {spawnSync} from 'node:child_process';
if(!process.env.TEST_DATABASE_URL_UNPOOLED||process.env.NFT_TEST_DISPOSABLE_DATABASE!=='yes')throw new Error('Configure an EMPTY disposable TEST_DATABASE_URL_UNPOOLED and NFT_TEST_DISPOSABLE_DATABASE=yes. Never use production.');
const result=spawnSync(process.execPath,['--test','test-auth/durable-postgres.test.mjs'],{stdio:'inherit',env:{...process.env,NFT_POSTGRES_TEST:'1'},timeout:120000});
if(result.error)throw new Error('Native PostgreSQL test process did not complete.');process.exit(result.status??1);
