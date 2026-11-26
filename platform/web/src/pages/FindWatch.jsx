import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import CityPicker from "../components/places/CityPicker";
import WatchListForCity from "../components/places/WatchListForCity";
import SuburbSuggest from "../components/places/SuburbSuggest";
import { useAuth } from "../auth/useAuth";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import { supabase } from "../supabase/client";
import { loadCity, mySuburbRequests } from "../utils/places";
import { mySuburbRequestLabel } from "../utils/placesView";
import { fetchParentCity } from "../utils/cityScope";

/** After sign-up: choose your city, then join a watch or ask for your suburb (D6: signed-in only). */
export default function FindWatch() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { refreshOrganizations } = useActiveOrganization();
  const [city, setCity] = useState(null);
  const [cityReady, setCityReady] = useState(false);
  const [requests, setRequests] = useState([]);
  const [requestsKey, setRequestsKey] = useState(0);

  // Start from the city chosen at sign-up, else the platform's home city.
  useEffect(() => {
    let ignore = false;
    void (async () => {
      let chosen = null;
      try {
        const { data } = await supabase.auth.getUser();
        chosen = await loadCity(data?.user?.user_metadata?.home_city_id);
      } catch {
        chosen = null;
      }
      if (!chosen) {
        const parent = await fetchParentCity();
        chosen = parent?.id ? await loadCity(parent.id) : null;
      }
      if (!ignore) {
        setCity(chosen);
        setCityReady(true);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    void mySuburbRequests().then((rows) => {
      if (!ignore) setRequests(rows);
    });
    return () => {
      ignore = true;
    };
  }, [requestsKey]);

  const handleJoined = async () => {
    try {
      await refreshUser?.();
      await refreshOrganizations?.({ silent: true });
    } finally {
      navigate("/dashboard", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Find your neighbourhood watch"
          subtitle="Choose your city or town, then join the watch for your suburb."
          backTo="/dashboard"
          backLabel="Back to dashboard"
        />
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-6">
          {cityReady ? (
            <CityPicker id="find-watch-city" label="Where do you live?" value={city} onChange={setCity} required />
          ) : (
            <p className="text-sm text-text-tertiary">Loading…</p>
          )}
          {city?.id ? (
            <>
              <WatchListForCity city={city} onJoined={() => void handleJoined()} />
              <SuburbSuggest
                key={city.id}
                city={city}
                onJoined={() => void handleJoined()}
                onRequested={() => setRequestsKey((k) => k + 1)}
              />
            </>
          ) : null}
          {requests.length ? (
            <section aria-labelledby="my-suburb-requests" className="space-y-2">
              <h2 id="my-suburb-requests" className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Your suburb requests
              </h2>
              <ul className="space-y-1 text-sm text-text-secondary">
                {requests.map((r) => (
                  <li key={r.id}>{mySuburbRequestLabel(r)}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
