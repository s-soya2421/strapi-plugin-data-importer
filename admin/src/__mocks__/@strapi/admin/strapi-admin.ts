// Minimal stub for jest — actual implementation is overridden by jest.mock() in tests
export const useFetchClient = () => ({
  get: jest.fn(),
  post: jest.fn(),
});
