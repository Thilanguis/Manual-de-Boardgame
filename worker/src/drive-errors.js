import { ApiError } from './auth.js';
import { DRIVE_MESSAGES } from '../../js/drive-diagnostics.js';

export function driveError(code, status = 503, retryAfter = 60) {
  return Object.assign(new ApiError(status, DRIVE_MESSAGES[code]), { code, retryAfter });
}
export async function driveResponseError(response) {
  const details = await response.json().catch(() => ({}));
  const reasons = (details.error?.errors || []).map((item) => item.reason);
  if (response.status === 429 || reasons.some((r) => ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(r))) return driveError('drive/rate-limit', 429);
  if (response.status === 404) return driveError('drive/file-missing', 404, 0);
  if (response.status === 401) return driveError('drive/oauth-rejected');
  if (reasons.includes('accessNotConfigured') || details.error?.details?.some((item) => item.reason === 'SERVICE_DISABLED')) return driveError('drive/configuration');
  if (response.status === 403) return driveError('drive/file-permission', 403, 0);
  return driveError('drive/unavailable');
}
