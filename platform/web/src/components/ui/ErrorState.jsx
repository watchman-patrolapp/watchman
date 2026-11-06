import Button from "./Button";

export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-danger bg-danger-light px-4 py-6 text-center"
    >
      <p className="font-semibold text-danger-foreground">{title}</p>
      {message ? <p className="mt-1 text-sm text-danger-foreground">{message}</p> : null}
      {onRetry ? (
        <Button variant="danger" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
