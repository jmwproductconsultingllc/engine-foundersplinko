"use client";

// components/LeadVerifyBeacon.tsx (spec v2, D1)
// On the brand teaser page: if the URL carries ?lead=<token> (the emailed
// link), POST it to /api/lead/verify once — flips the Supabase lead to verified
// and fires lead_email_link_clicked. The click IS the verification. Renders
// nothing.

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";

export default function LeadVerifyBeacon() {
  const params = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    const token = params.get("lead");
    if (!token || fired.current) return;
    fired.current = true;
    track("lead_email_link_clicked", { token });
    fetch("/api/lead/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }, [params]);

  return null;
}
