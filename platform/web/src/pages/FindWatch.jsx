import { useNavigate } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import MyAreaSection from "../components/places/MyAreaSection";

/** After sign-up: choose your city, then join a watch or ask for your suburb (D6: signed-in only). */
export default function FindWatch() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Find your neighbourhood watch"
          subtitle="Choose your city or town, then join the watch for your suburb."
          backTo="/dashboard"
          backLabel="Back to dashboard"
        />
        <MyAreaSection
          startOpen
          onWatchChanged={(result) => {
            if (result?.status === "joined" || result?.status === "switched") navigate("/dashboard", { replace: true });
          }}
        />
      </div>
    </div>
  );
}
