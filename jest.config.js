module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.js$': ['babel-jest', { configFile: './babel.config.test.js' }] },
  testMatch: ['**/__tests__/**/*.test.js'],
};
