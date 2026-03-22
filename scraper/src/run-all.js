import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(cmd) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: join(__dirname, '..'), stdio: 'inherit' });
}

async function main() {
  const args = process.argv.slice(2);
  const skipScrape = args.includes('--skip-scrape');

  if (!skipScrape) {
    // Step 1: Discover events
    run('node src/scraper.js discover');

    // Step 2: Scrape all events
    run('node src/scraper.js all');
  }

  // Step 3: Build driver registry
  run('node src/driver-registry.js');

  // Step 4: Compute rankings
  run('node src/rank-algorithm.js');

  // Step 5: Generate frontend data
  run('node src/generate-output.js');

  console.log('\n=== All done! ===');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
