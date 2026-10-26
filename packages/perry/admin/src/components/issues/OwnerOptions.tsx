// components/issues/OwnerOptions — shared owner <option> list for the issue forms.
import type { UserRecord } from "../../types";

/** `<option>`s for an owner `<select>`: "Unassigned" plus every known user. */
export function OwnerOptions({ users }: { users: UserRecord[] }) {
  return (
    <>
      <option value="">Unassigned</option>
      {users.map((user) => (
        <option value={user.displayName} key={user.id}>
          {user.displayName}
        </option>
      ))}
    </>
  );
}
