module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }]
  },
  moduleNameMapper: {
    '^\\./encryption.streaming.worker.js$': '<rootDir>/test/mocks/mock.worker.ts'
  },
  transformIgnorePatterns: ['node_modules/(?!libsodium-wrappers)']
};