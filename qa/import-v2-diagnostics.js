try {
  require('./import-v2.test.js');
} catch (error) {
  const message = String(error?.stack || error?.message || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error file=qa/import-v2.test.js::${message}`);
  process.exit(1);
}
