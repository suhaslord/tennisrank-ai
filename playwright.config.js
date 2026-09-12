const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './qa',
  timeout: 30000,
  expect: { timeout: 7000 },
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
});
