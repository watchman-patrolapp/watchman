/** PostgREST: missing function / schema cache — stop retrying RPC every poll to avoid F12 404 spam */
export function isRpcNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  const code = error.code;
  const msg = (error.message || '').toLowerCase();
  const details = (error.details || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    details.includes('does not exist')
  );
}
