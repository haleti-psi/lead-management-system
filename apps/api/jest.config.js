/**
 * Jest config for @lms/api (unit tests). ts-jest compiles TS with the api
 * tsconfig (decorators/metadata enabled). `@lms/shared` resolves to the built
 * package output — the same artifact `nest build` consumes — so tests exercise
 * the real shared enums/types. Tests are `*.spec.ts` adjacent to source.
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Populate required env (environment-contract.md) before modules that wire
  // ConfigModule.forRoot({ validate }) are imported — that validation is eager.
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.json' },
    ],
  },
  moduleNameMapper: {
    '^@lms/shared$': '<rootDir>/../../../packages/shared/dist/index.js',
    '^@lms/shared/(.*)$': '<rootDir>/../../../packages/shared/dist/$1',
  },
  clearMocks: true,
};
