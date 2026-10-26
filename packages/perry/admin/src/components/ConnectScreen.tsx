// components/ConnectScreen — the pre-load screen: a spinner while the initial load
// runs, and the admin-token prompt when it fails.
import { Loader2 } from "lucide-react";

/** Shown until the config has loaded: a spinner, or the admin-token prompt when the load failed. */
export function ConnectScreen({
  failed,
  error,
  adminToken,
  onTokenChange,
  onConnect,
}: {
  failed: boolean;
  error: string;
  adminToken: string;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
}) {
  if (failed) {
    return (
      <main className="shell">
        <form
          className="loading"
          onSubmit={(event) => {
            event.preventDefault();
            onConnect();
          }}
        >
          {/* Statuses are detected from the message text: ApiError formats it as "<label> failed: <status>". */}
          <span>{connectMessage(error)}</span>
          <input
            aria-label="Admin API token"
            className="token-input"
            placeholder="Admin token"
            type="password"
            value={adminToken}
            onChange={(event) => onTokenChange(event.target.value)}
          />
          <button className="primary" type="submit">
            Connect
          </button>
        </form>
      </main>
    );
  }
  return (
    <main className="shell">
      <div className="loading">
        <Loader2 className="spin" size={24} />
        <span>Loading Perry</span>
      </div>
    </main>
  );
}

/** 401: the token is missing or wrong. 503: the server has no ADMIN_API_TOKEN, so no token can work yet. */
function connectMessage(error: string): string {
  if (error.includes(": 401")) return "Enter the admin API token to connect to Perry.";
  if (error.includes(": 503")) return "The server has no ADMIN_API_TOKEN configured. Set it (pnpm bootstrap generates one), restart Perry, then connect.";
  return error;
}
