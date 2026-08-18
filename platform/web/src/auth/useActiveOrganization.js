import { useContext } from "react";
import { ActiveOrganizationContext } from "./ActiveOrganizationContext";

export function useActiveOrganization() {
  const context = useContext(ActiveOrganizationContext);
  if (!context) {
    throw new Error("useActiveOrganization must be used within an ActiveOrganizationProvider");
  }
  return context;
}
