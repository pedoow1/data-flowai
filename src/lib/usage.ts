import { useEffect, useState } from "react";

const KEY = "dataflow_usage_count";
const PLAN_KEY = "dataflow_plan";

import type { Plan } from "./config";

export function usePlan() {
  const [plan, setPlanState] = useState<Plan>("free");
  useEffect(() => {
    const p = (localStorage.getItem(PLAN_KEY) as Plan) || "free";
    setPlanState(p);
  }, []);
  const setPlan = (p: Plan) => { localStorage.setItem(PLAN_KEY, p); setPlanState(p); };
  return { plan, setPlan };
}

export function useUsage() {
  const [used, setUsed] = useState(0);
  useEffect(() => {
    setUsed(Number(localStorage.getItem(KEY) || 0));
  }, []);
  const bump = (n = 1) => {
    const v = Number(localStorage.getItem(KEY) || 0) + n;
    localStorage.setItem(KEY, String(v));
    setUsed(v);
  };
  const reset = () => { localStorage.setItem(KEY, "0"); setUsed(0); };
  return { used, bump, reset };
}
