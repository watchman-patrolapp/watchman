import { useNavigate } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import AboutBrandBlock from "../components/about/AboutBrandBlock";
import FeedbackForm from "../components/about/FeedbackForm";

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-4 py-8 dark:from-gray-900 dark:to-gray-800 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">About</h1>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              <FaArrowLeft className="h-3 w-3" />
              Back
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-soft dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-6 p-6 sm:p-8">
            <AboutBrandBlock />
            <hr className="border-gray-200 dark:border-gray-700" />
            <FeedbackForm />
          </div>
        </div>
      </div>
    </div>
  );
}
