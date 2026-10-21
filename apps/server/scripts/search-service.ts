import { setupNetwork } from '../src/net.ts';
import { ensureLocalSearch, localSearchLogs, stopLocalSearch } from '../src/tools/local-search.ts';

setupNetwork();
const action = process.argv[2] ?? 'up';
if (action === 'up') { await ensureLocalSearch(); console.log('SearXNG local est prêt.'); }
else if (action === 'down') { await stopLocalSearch(); console.log('SearXNG local est arrêté.'); }
else if (action === 'logs') console.log(await localSearchLogs());
else throw new Error('Action attendue : up, down ou logs');
