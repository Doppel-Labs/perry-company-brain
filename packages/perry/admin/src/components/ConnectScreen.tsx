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
          {/* A 401 is detected from the message text: ApiError formats it as "<label> failed: 401". */}
          <span>{error.includes(": 401") ? "Enter the admin API token to connect to Perry." : error}</span>
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
