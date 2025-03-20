import retry from "p-retry";
import crypto from "crypto";

/**
 * Create a hash of the content for quick comparison
 * @param content String content to hash
 * @returns SHA-256 hash of the content as a hex string
 */
export const createContentHash = (content: string | Buffer): string => {
  return crypto.createHash("sha256").update(content).digest("hex");
};

export const formatPrice = (n: number | undefined | null) => {
  if (n === undefined || n === null) {
    return "-";
  }
  // For very small numbers (less than 0.01), keep all decimal places
  if (Math.abs(n) < 0.01 && n !== 0) {
    return n.toString();
  }
  // For other numbers, format with 2 decimal places
  return n.toFixed(2);
};

export const formatDenominator = (n: number) => {
  if (Math.abs(n) >= 1000000) {
    return n % 1000000 === 0
      ? `${n / 1000000}M`
      : `${(n / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(n) >= 1000) {
    return n % 1000 === 0 ? `${n / 1000}K` : `${(n / 1000).toFixed(1)}K`;
  }
  return n.toString();
};

export const capitalizeFirst = (s: string) => {
  return s[0].toUpperCase() + s.slice(1);
};

export const withRetry = <T>(fn: () => Promise<T>) =>
  retry(fn, {
    retries: 3,
    minTimeout: 3000,
    factor: 2,
    shouldRetry: (error: Error) => {
      return true;
      // if (error.message?.toLowerCase().includes("rate limit")) return true;
      // if (error.stack?.toLowerCase().includes("rate limit")) return true;
      // return false;
    },
    onFailedAttempt: (error: {
      attemptNumber: number;
      retriesLeft: number;
    }) => {
      console.log(
        `Attempt ${error.attemptNumber} failed. Retries left: ${error.retriesLeft}`
      );
    },
  });
