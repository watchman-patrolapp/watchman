import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useEffect, useRef } from "react";
import { useAuth } from "../auth/useAuth";
import PageSkeleton from "./layout/PageSkeleton";
import { canAccessPlatformConsole } from "../auth/platformRoles";

export default function RequirePlatformRole({ children }) {
  const { user, loading, sessionReady } = useAuth();
  const toastFiredRef = useRef(false);

  if (!sessionReady || loading) {
    return <PageSkeleton message="Checking access…" />;
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!canAccessPlatformConsole(user.platformRole)) {
    return <PlatformAccessDenied toastFiredRef={toastFiredRef} />;
  }

  return <>{children}</>;
}

function PlatformAccessDenied({ toastFiredRef }) {
  useEffect(() => {
    if (!toastFiredRef.current) {
      toastFiredRef.current = true;
      toast.error("Platform Console access is required.");
    }
  }, [toastFiredRef]);

  return <Navigate to="/admin" replace />;
}
