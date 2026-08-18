/** PostgREST: missing function / schema cache — stop retrying RPC every poll to avoid F12 404 spam */
export function isRpcNotFoundError(error) {
  if (!error) return false;
  const code = error.code;
  const msg = (error.message || "").toLowerCase();
  const details = (error.details || "").toLowerCase();
  if (code === "42703") return false;
  if ((msg.includes("column") || details.includes("column")) && msg.includes("does not exist")) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist")) ||
    (details.includes("function") && details.includes("does not exist"))
  );
}
