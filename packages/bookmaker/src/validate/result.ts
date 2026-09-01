// --- exports ---

export type ValidationSuccess<T> = {
  readonly ok: true;
  readonly value: T;
};

export type ValidationFailure = {
  readonly ok: false;
  readonly issues: readonly string[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export const validationSuccess = <T>(value: T): ValidationSuccess<T> => ({
  ok: true,
  value
});

export const validationFailure = (...issues: readonly string[]): ValidationFailure => ({
  ok: false,
  issues
});
