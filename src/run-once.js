require('dotenv').config();

if (process.env.RUN_ONCE_KEEP_LOGS !== 'true') {
  process.env.LOG_LEVEL = process.env.RUN_ONCE_LOG_LEVEL || 'error';
}

const { scrapeCrewNow, getRuntimeConfig } = require('./scrape');

(async () => {
  try {
    const config = getRuntimeConfig();
    const report = await scrapeCrewNow(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error.message || error);
    process.exit(1);
  }
})();
