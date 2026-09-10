import { createApp } from './app';

async function main() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 8000), process.env.APP_HOST || '127.0.0.1');
}
void main();
