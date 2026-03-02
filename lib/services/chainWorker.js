const { initChainQueue } = require('./chainQueue');

const context = initChainQueue({ withWorker: true });
if (!context) {
  process.stdout.write('Chain worker disabled. Configure REDIS_URL, RPC_URL, DEATH_REGISTRY_ADDRESS.\n');
  process.exit(0);
}

process.stdout.write('Chain worker started\n');
