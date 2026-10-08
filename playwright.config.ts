import { defineConfig } from '@playwright/test';
process.loadEnvFile('.env.local');
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:90000,
  expect:{timeout:15000},use:{baseURL:'http://127.0.0.1:3000',headless:true,channel:'chrome',trace:'retain-on-failure'},
  reporter:[['list']],
});
