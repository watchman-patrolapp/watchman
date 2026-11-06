import { useCallback, useEffect, useState } from "react";
import { readScreenSnapshot, writeScreenSnapshot } from "./snapshots";

/**
 * Last-good copy for one screen, one person, one neighbourhood.
 * Changing neighbourhood clears the previous copy before the next read resolves.
 */
export function useScreenSnapshot(userId, organizationId, screen) {
  const [record, setRecord] = useState(null);

  useEffect(() => {
    let cancel = false;
    setRecord(null);
    if (!userId || !screen) return undefined;
    void readScreenSnapshot({ userId, organizationId, screen }).then((row) => {
      if (!cancel) setRecord(row);
    });
    return () => {
      cancel = true;
    };
  }, [userId, organizationId, screen]);

  const save = useCallback((data) => {
    if (!userId || !screen) return Promise.resolve(null);
    return writeScreenSnapshot({ userId, organizationId, screen }, data).then((row) => {
      if (row) setRecord(row);
      return row;
    });
  }, [userId, organizationId, screen]);

  return {
    record,
    savedAt: record?.savedAt ?? null,
    save,
  };
}
