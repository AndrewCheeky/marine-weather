// Isolated test uses the same master-cache renderer and scoring source as production.
process.env.MARINE7_TEST='1';
await import('./generate-seven-day.mjs');
