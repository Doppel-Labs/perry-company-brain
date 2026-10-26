// hooks/useAdminToken — the admin token as React state for the token inputs.
import { useState } from "react";
import { readStoredAdminToken, storeAdminToken } from "../api/client";

/** The setter also hands the token to api/client, so the next request uses it. */
export function useAdminToken() {
  const [adminToken, setAdminTokenState] = useState(readStoredAdminToken);
  const setAdminToken = (value: string) => {
    setAdminTokenState(value);
    storeAdminToken(value);
  };
  return { adminToken, setAdminToken };
}
