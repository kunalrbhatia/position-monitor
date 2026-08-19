/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(@scure|otplib)/)'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 50,
      lines: 55,
      statements: 55,
    },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
};
