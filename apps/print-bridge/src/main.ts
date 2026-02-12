import { config, validateConfig } from './config';
import { apiClient, PrintJob } from './api-client';
import { receiptGenerator } from './receipt-generator';

let isRunning = true;

async function processJob(job: PrintJob): Promise<void> {
  console.log(`📋 Processing job ${job.id} (${job.type}) for order #${job.payloadJson.orderNumber}`);

  try {
    // Claim the job
    await apiClient.claimJob(job.id);
    console.log(`  ✓ Job claimed`);

    // Generate receipt
    const filepath = await receiptGenerator.generateReceipt(job);
    console.log(`  ✓ Receipt generated: ${filepath}`);

    // Mark as complete
    await apiClient.completeJob(job.id, true);
    console.log(`  ✓ Job completed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  ✗ Job failed: ${errorMessage}`);

    try {
      await apiClient.completeJob(job.id, false, errorMessage);
    } catch (completeError) {
      console.error(`  ✗ Failed to report error: ${completeError}`);
    }
  }
}

async function pollJobs(): Promise<void> {
  try {
    const jobs = await apiClient.getPendingJobs(5);

    if (jobs.length === 0) {
      process.stdout.write('.');
    } else {
      console.log(`\n🔔 Found ${jobs.length} pending job(s)`);

      for (const job of jobs) {
        await processJob(job);
      }
    }
  } catch (error) {
    console.error(`\n❌ Error polling jobs:`, error);
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('🖨️  PRINT BRIDGE SERVICE');
  console.log('='.repeat(50));

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('❌ Configuration error:', error);
    process.exit(1);
  }

  console.log(`📡 API URL: ${config.apiUrl}`);
  console.log(`🏢 Tenant ID: ${config.tenantId}`);
  console.log(`⏱️  Poll Interval: ${config.pollInterval}ms`);
  console.log(`📁 Output Dir: ${config.outputDir}`);
  console.log('='.repeat(50));

  // Initialize receipt generator
  console.log('🚀 Initializing browser...');
  await receiptGenerator.init();
  console.log('✅ Browser ready');
  console.log('');
  console.log('👀 Watching for print jobs...');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    isRunning = false;
    await receiptGenerator.close();
    console.log('👋 Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Shutting down...');
    isRunning = false;
    await receiptGenerator.close();
    console.log('👋 Goodbye!');
    process.exit(0);
  });

  // Poll for jobs
  while (isRunning) {
    await pollJobs();
    await new Promise((resolve) => setTimeout(resolve, config.pollInterval));
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


