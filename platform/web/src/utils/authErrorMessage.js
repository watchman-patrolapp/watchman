/**
 * User-facing copy for Supabase Auth errors (raw API messages are often cryptic).
 * @param {unknown} err
 */
export function formatAuthErrorMessage(err) {
  const msg = typeof err?.message === 'string' ? err.message : '';
  const lower = msg.toLowerCase();
  const code = err?.code;
  const status = err?.status;

  if (
    lower.includes('rate limit') ||
    lower.includes('too many emails') ||
    lower.includes('email rate limit') ||
    status === 429
  ) {
    return 'Too many confirmation emails were sent. Please wait up to an hour and try again, or use Sign in if you already registered. (This limit is set in Supabase — admins can adjust Authentication → Rate Limits.)';
  }
  if (
    lower.includes('already registered') ||
    lower.includes('user already registered') ||
    lower.includes('already been registered') ||
    code === 'user_already_exists'
  ) {
    return 'An account with this email already exists. Use Sign in, or reset your password from the login page.';
  }
  if (lower.includes('invalid login credentials') || code === 'invalid_credentials') {
    return 'Email or password is incorrect.';
  }
  if (lower.includes('password') && lower.includes('should be')) {
    return msg;
  }

  return msg || 'Something went wrong. Please try again.';
}
