import { getConfig } from '@whatres/config';

const config = getConfig();

console.log('🔧 Worker starting...');
console.log(`Environment: ${config.server.nodeEnv}`);
console.log(`Redis: ${config.redis.host}:${config.redis.port}`);

// Placeholder for future queue processing
// Example: BullMQ, Agenda, or custom queue implementation

async function main() {
  console.log('✅ Worker is ready for queue jobs');
  console.log('ℹ️  Add your queue processing logic here');

  // Keep the process alive
  process.on('SIGTERM', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Worker shutting down...');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});


