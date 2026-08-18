import { FaEnvelope, FaWhatsapp } from "react-icons/fa";

export default function AboutBrandBlock() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700 dark:text-gray-300">
        <strong>Neighbourhood Watch Platform</strong> was created to help communities organise
        patrols, report incidents, and coordinate safety efforts.
      </p>
      <p className="text-gray-700 dark:text-gray-300">
        <strong>Created by:</strong> Africuz Creative Hub
        <br />
        <strong>All rights reserved © 2026</strong>
      </p>
      <div className="flex flex-col gap-2">
        <a
          href="mailto:africuzprojects@gmail.com"
          className="inline-flex items-center gap-2 text-sm text-teal-600 hover:underline dark:text-teal-400"
        >
          <FaEnvelope className="h-4 w-4 shrink-0" aria-hidden />
          africuzprojects@gmail.com
        </a>
        <a
          href="https://wa.me/27814954910"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-green-600 hover:underline dark:text-green-400"
        >
          <FaWhatsapp className="h-4 w-4 shrink-0" aria-hidden />
          +27 81 495 4910
        </a>
      </div>
    </div>
  );
}
