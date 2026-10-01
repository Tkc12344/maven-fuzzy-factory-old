import { useCallback, useEffect, useState } from "react";
import { getJson } from "./api.js";

export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (overridePath) => {
      setLoading(true);
      try {
        const next = await getJson(overridePath || path);
        setData(next);
        setError("");
        return next;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [path]
  );

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { data, error, loading, reload };
}
