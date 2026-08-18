import { FaInfoCircle, FaLightbulb } from "react-icons/fa";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import AboutBrandBlock from "../components/about/AboutBrandBlock";
import FeedbackForm from "../components/about/FeedbackForm";

const HOW_TO_SECTIONS = [
  {
    title: "Home",
    body: "Your household card at the top is your identity in this neighbourhood. Tap it to open Profile and update your name, photo, phone, and home address. Keep your address current so patrol can find you in an emergency.",
  },
  {
    title: "SOS",
    body: "Hold the red SOS button for two seconds when you need immediate help. Patrol and admins are notified with your location if GPS is on. Use SOS only for real danger. For anything else, send a report instead.",
  },
  {
    title: "Report incident",
    body: "Log suspicious activity, a vehicle, noise, or other non-urgent observations. You can attach photos or video, and you may send an anonymous tip. Patrol reviews the report before it is logged.",
  },
  {
    title: "Your reports",
    body: "This is your personal history of what you submitted. Status stays here even after it leaves the home feed: pending review, logged for patrol, or not accepted. Use this page to check acknowledgements.",
  },
  {
    title: "SOS board",
    body: "See live SOS alerts in this neighbourhood. Active alerts stay until a responder clears them. After someone clears an SOS, neighbours still see it on the home activity list for 15 minutes.",
  },
  {
    title: "Chat with patrol",
    body: "Message the duty team in your neighbourhood. Chat is for coordination, not a substitute for SOS. Messages disappear from the chat after 24 hours. Admins can still review older chat logs if needed.",
  },
  {
    title: "Verify neighbours",
    body: "New households stay pending until an admin, NW admin, or patroller verifies them, or two neighbours who know them personally vouch. Only vouch for people you actually know. Do not ask strangers to vouch for you. SOS still works while you are pending.",
  },
  {
    title: "My sector",
    body: "Up to 10 closest households within 1.2 km who have pinned their home on Profile. Your typed address is not used for distance — lots and house numbers are often missing or wrong on the map. Set the pin on Profile (tap the roof, or use I’m here at the gate). Street names only; house numbers stay private. Neighbours without a pin, or farther than 1.2 km, do not appear here.",
  },
  {
    title: "Emergency contacts",
    body: "Local numbers for police, fire, ambulance, electrical, municipality, and security companies covering this area. Use these for civic emergencies. Use SOS on this app when you need neighbourhood patrol right now.",
  },
  {
    title: "Neighbourhood activity",
    body: "The list at the bottom of Home shows recent neighbour reports and SOS, newest first. This is a live window for the street, not a permanent archive. Your own full history stays on Your reports.",
  },
];

function GuideCard({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {children}
      </div>
    </section>
  );
}

export default function ResidentGuide() {
  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="How to use"
          subtitle="A short guide to the resident home, plus about and feedback."
          backTo="/resident"
          backLabel="Back to resident home"
          rightSlot={<ThemeToggle variant="toolbar" />}
        />

        <GuideCard title="Welcome">
          <p>
            This screen is for household SOS, reports, neighbours, and My sector. If you also patrol,
            your patrol dashboard stays your home after login — open Resident Portal from there. Name,
            email, and phone stay on the same profile; set a home pin so My sector can find nearby
            homes.
          </p>
        </GuideCard>

        <GuideCard title="How long things stay visible">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Home activity — reports:</strong>{" "}
              neighbour reports stay on the bottom activity list for 10 hours, newest first.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Home activity — SOS:</strong>{" "}
              an uncleared SOS stays until someone clears it. After it is cleared, it stays on the
              list for 15 minutes, then drops off.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Your reports:</strong>{" "}
              your own submissions stay on Your reports with their review status. That page is not
              limited to 10 hours.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Neighbourhood notices:</strong>{" "}
              stay at the top of Home for 12 hours, then move to Neighbourhood activity for 12 more hours, then disappear.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Chat:</strong>{" "}
              messages disappear from chat after 24 hours. Do not use chat for holiday dates or
              utility shutdowns — those have their own places in the app.
            </li>
          </ul>
        </GuideCard>

        <GuideCard title="We are away">
          <p>
            On Profile, set the dates you will be gone. Patrol and neighbourhood watch staff can see
            that your house needs extra eyes. Other households cannot. Chat is the wrong place for
            this because messages disappear after 24 hours.
          </p>
        </GuideCard>

        <GuideCard title="Neighbourhood notices">
          <p>
            Power cuts, planned water shutdowns, and other area updates appear as a notice at the top
            of Home for 12 hours. After that they move into Neighbourhood activity for 12 more hours,
            then disappear. Admin, technical support, NW admin, and committee can type a short
            headline and paste a WhatsApp message, then send it to this neighbourhood. The headline
            is the lock-screen title.
          </p>
        </GuideCard>

        <GuideCard title="Your household">
          <p>
            Only you see these on Home and Profile. Neighbours cannot see each other’s streaks or
            badges.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Verified</strong> is
              the main civic badge — staff or two neighbours you know.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Street watch</strong>{" "}
              after you open the app three days in a row (“Looking out · 3 days”).
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">Good neighbour</strong>{" "}
              when you vouch for someone you know.
            </li>
            <li>
              <strong className="font-semibold text-gray-800 dark:text-gray-200">First report</strong>{" "}
              after one approved activity report. SOS does not count.
            </li>
          </ul>
        </GuideCard>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <FaLightbulb className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
            Each page on Home
          </h2>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            These match the tiles on the resident dashboard.
          </p>
          <ol className="space-y-4">
            {HOW_TO_SECTIONS.map((section, index) => (
              <li
                key={section.title}
                className="border-b border-gray-100 pb-4 last:border-0 last:pb-0 dark:border-gray-700"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  <span className="mr-2 font-mono text-[11px] text-teal-700 dark:text-teal-400">
                    {index + 1}.
                  </span>
                  {section.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {section.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p>
            <strong className="font-semibold">Safety:</strong> SOS is for immediate danger. Reports
            are for observations. Always stay within the law. If you are unsure, use chat or the
            contacts list rather than putting yourself at risk.
          </p>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <FaInfoCircle className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden />
            About
          </h2>
          <AboutBrandBlock />
          <hr className="my-6 border-gray-200 dark:border-gray-700" />
          <FeedbackForm />
        </section>
      </div>
    </div>
  );
}
