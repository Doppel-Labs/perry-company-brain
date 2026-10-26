// components/SecretsPanel — which secrets are set. The server reports booleans only;
// secret values never reach the browser.
import { KeyRound } from "lucide-react";
import { SectionTitle } from "./shared";

export function SecretsPanel({ secrets }: { secrets: Record<string, boolean> }) {
  return (
    <section className="panel secret-panel">
      <SectionTitle icon={<KeyRound size={19} />} title="Secrets" />
      <div className="secret-grid">
        {Object.entries(secrets).map(([key, value]) => (
          <div className="secret" key={key}>
            <span>{key}</span>
            <strong>{value ? "set" : "missing"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
