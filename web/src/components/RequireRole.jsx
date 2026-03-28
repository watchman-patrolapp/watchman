import { useAuth } from "../auth/useAuth";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useEffect, useRef } from "react";
import PageSkeleton from "./layout/PageSkeleton";

/** Legacy DB values: `patrol` treated as `patroller` for route access. */
function normalizeUserRole(role) {
  if (role == null || role === "") return null;
  const r = String(role).trim().toLowerCase();
  if (r === "patrol") return "patroller";
  return r;
}

function normalizeAllowedRoles(allowedRoles) {
  return allowedRoles.map((r) => String(r).trim().toLowerCase());
}

export default function RequireRole({ children, allowedRoles = [] }) {
  const { user, loading } = useAuth();
  const toastFiredRef = useRef(false);

  if (loading) {
    return <PageSkeleton message="Checking access…" />;
  }

  if (!user) return <Navigate to="/login" replace />;

  const userNorm = normalizeUserRole(user.role);
  const allowedNorm = normalizeAllowedRoles(allowedRoles);
  const hasAccess = Boolean(userNorm && allowedNorm.includes(userNorm));

  if (!hasAccess) {
    return <AccessDenied toastFiredRef={toastFiredRef} />;
  }

  return <>{children}</>;
}

function AccessDenied({ toastFiredRef }) {
  useEffect(() => {
    if (!toastFiredRef.current) {
      toastFiredRef.current = true;
      toast.error("You don't have permission to access that page.");
    }
  }, [toastFiredRef]);

  return <Navigate to="/dashboard" replace />;
}
