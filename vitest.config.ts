import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Several property tests run hundreds of full shot simulations. That is
    // genuinely slow on a Raspberry Pi, and the default 5s starts failing them
    // as soon as workers compete for cores. Shrinking the sweeps to fit would
    // trade away the coverage that makes them worth having.
    testTimeout: 60_000,
  },
});
