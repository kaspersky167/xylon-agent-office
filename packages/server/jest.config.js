module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
    moduleNameMapper: {
        '^@agent-office/core$': '<rootDir>/../core/src',
        '^@agent-office/adapters$': '<rootDir>/../adapters/src'
    }
};
