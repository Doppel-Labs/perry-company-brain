// hooks/useAdminToken — the admin token as React state for the token inputs.
import { useState } from "react";
import { currentToken, setAdminTokenForRequests } from "../api/client";

/** The setter also hands the token to api/client, so the next request uses it. */
export function useAdminToken() {
  const [adminToken, setAdminTokenState] = useState(currentToken);
  const setAdminToken = (value: string) => {
    setAdminTokenState(value);
    setAdminTokenForRequests(value);
  };
  return { adminToken, setAdminToken };
}
