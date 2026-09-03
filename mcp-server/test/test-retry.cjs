/**
 * Unit tests for bounded retry behavior.
 *
 * Run: node test/test-retry.cjs
 */
async function main() {
  const { MAX_RETRIES, retryOperation } = await import('../dist/utils/retry.js');

  let passed = 0;
  let failed = 0;
  const pass = (label, ok) => {
    if (ok) {
      passed++;
      console.log(`  PASS ${label}`);
    } else {
      failed++;
      process.exitCode = 1;
      console.log(`  FAIL ${label}`);
    }
  };

  console.log('\nTest 1: succeeds after two retries');
  {
    let attempts = 0;
    const result = await retryOperation(
      'test operation',
      async () => {
        attempts++;
        if (attempts <= MAX_RETRIES) throw new Error('temporary failure');
        return 'success';
      },
      { delayMs: 0 },
    );

    pass('returns the successful result', result === 'success');
    pass('makes the initial attempt plus two retries', attempts === 3);
  }

  console.log('\nTest 2: surfaces the final failure after two retries');
  {
    let attempts = 0;
    let thrown;
    try {
      await retryOperation(
        'test operation',
        async () => {
          attempts++;
          throw new Error(`failure ${attempts}`);
        },
        { delayMs: 0 },
      );
    } catch (error) {
      thrown = error;
    }

    pass('makes the initial attempt plus two retries', attempts === 3);
    pass('throws the final operation error', thrown instanceof Error && thrown.message === 'failure 3');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
