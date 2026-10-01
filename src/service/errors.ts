export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DEGREE_EXCEEDED'
  | 'ZERO_POLYNOMIAL_ROOT_COUNT_UNDEFINED'
  | 'BAD_INTERVAL'
  | 'INTERVAL_CONTAINS_ROOT'
  | 'BAD_PAGINATION'
  | 'CONFLICT'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}
