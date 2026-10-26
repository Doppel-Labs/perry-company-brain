// components/TopBar — title, the admin token field, and Save, which writes the edited
// settings to the server config.
import { Loader2, Save } from "lucide-react";

export function TopBar({
  adminToken,
  onTokenChange,
  saving,
  onSave,
}: {
  adminToken: string;
  onTokenChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">Doppel Labs</div>
        <h1>Perry Admin</h1>
      </div>
      <div className="top-actions">
        <input
          aria-label="Admin API token"
          className="token-input"
          placeholder="Admin token"
          type="password"
          value={adminToken}
          onChange={(event) => onTokenChange(event.target.value)}
        />
        <button className="primary" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
          <span>{saving ? "Saving" : "Save"}</span>
        </button>
      </div>
    </header>
  );
}
