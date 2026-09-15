// Shared host env-reading utilities. Host reads process.env ONLY at these edges; downstream config
// is plain data. A present-but-empty var reads as "unset" so a blank export never shadows a default.

export const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? null : value;
};
