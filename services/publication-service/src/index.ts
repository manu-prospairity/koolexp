import 'dotenv/config';

import { loadConfig } from './config';
import { buildServer } from './server';

const start = async () => {
  const config = loadConfig();
  const app = buildServer(config);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info({ service: config.SERVICE_NAME }, 'Publication Service started');
  } catch (err) {
    app.log.error(err, 'Failed to start Publication Service');
    process.exit(1);
  }
};

void start();
